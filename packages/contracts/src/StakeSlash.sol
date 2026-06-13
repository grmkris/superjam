// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "./IYieldAdapter.sol";

/// Minimal ERC-20 surface (USDC on Arc/Base Sepolia, §15).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// SuperJam builder stake/slash escrow (PIVOT P3, §7) — a YIELD-BEARING conditional
/// escrow (Circle/Arc bounty #1 "advanced stablecoin logic").
///
/// Builders deposit USDC stake to take paid builds. The platform arbiter (the
/// Dynamic server wallet — the only privileged signer, §15.1) registers each
/// build, locking a `bond` from the builder's free stake and escrowing the build
/// `price`. Delivery is judged off-chain by the layered optimistic judge
/// (judge.ts): a deterministic deploy gate, an AI score against the spec's
/// acceptance list, then a community challenge window. The verdict lands here:
///
///   - clean, unchallenged delivery   → `finalize` (permissionless, after the
///     window): builder reclaims bond + earns price.
///   - bad / fraudulent delivery       → `resolve(slash=true)`: bond + price are
///     slashed to the treasury; a correct challenger is refunded + rewarded.
///   - frivolous challenge             → `resolve(slash=false)`: builder paid as
///     normal, the challenger's bond is forfeited to the treasury.
///
/// YIELD (bounty #1): while funds sit locked (stakes, bonds, escrowed prices),
/// they're supplied to an `IYieldAdapter` (our SimpleYieldVault, or an Aave/Morpho
/// adapter). The contract tracks `totalPrincipal` (everything owed back to
/// participants); anything the adapter holds above that is yield, swept to the
/// treasury by the permissionless `harvest()`. Participant payouts always return
/// exact principal — yield is pure upside for the platform. Set `_yieldAdapter`
/// to address(0) to disable (funds stay in-contract; behaviour identical to v1).
///
/// The stake is the economic backstop for Track-B mutability: a builder who
/// repoints `entryUrl` to phishing after delivery loses real money. Paired with
/// World ID (one-human registration, §14) for sybil resistance.
contract StakeSlash {
    address public immutable arbiter;
    IERC20 public immutable usdc;
    uint256 public immutable minStake;
    uint256 public immutable challengeWindow; // seconds
    address public treasury;

    /// Optional yield source (address(0) = disabled). Idle USDC is supplied here.
    IYieldAdapter public immutable yieldAdapter;
    /// Total USDC owed back to participants (stakes + bonds + prices + challenge
    /// bonds currently held). `adapter.assetsOf(this) - totalPrincipal` = yield.
    uint256 public totalPrincipal;

    enum Status { None, Assigned, Delivered, Finalized, Slashed }

    struct Build {
        address builder;
        uint256 price;        // USDC paid to the builder on success
        uint256 bond;         // builder stake locked against this build
        Status status;
        uint64 deliveredAt;   // challenge window opens here
        address challenger;   // address(0) until someone stakes to challenge
        uint256 challengeBond;
    }

    mapping(address => uint256) public stake;  // builder free (unlocked) stake
    mapping(bytes32 => Build) public builds;   // buildId (keccak of the api id)

    event Deposited(address indexed builder, uint256 amount);
    event Withdrawn(address indexed builder, uint256 amount);
    event BuildRegistered(bytes32 indexed buildId, address indexed builder, uint256 price, uint256 bond);
    event Delivered(bytes32 indexed buildId, uint64 at);
    event Challenged(bytes32 indexed buildId, address indexed challenger, uint256 bond);
    event Finalized(bytes32 indexed buildId, address indexed builder, uint256 price);
    event Slashed(bytes32 indexed buildId, address indexed builder, uint256 amount, bool delisted);
    event ChallengeResolved(bytes32 indexed buildId, bool upheld);
    event Harvested(address indexed treasury, uint256 yield);

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "not arbiter");
        _;
    }

    constructor(
        address _usdc,
        address _arbiter,
        address _treasury,
        uint256 _minStake,
        uint256 _challengeWindow,
        address _yieldAdapter
    ) {
        usdc = IERC20(_usdc);
        arbiter = _arbiter;
        treasury = _treasury;
        minStake = _minStake;
        challengeWindow = _challengeWindow;
        yieldAdapter = IYieldAdapter(_yieldAdapter);
    }

    // --- funds plumbing (yield-aware) ---

    /// Pull `amount` from `from` into the escrow and supply it to the yield
    /// adapter (if set). Increments tracked principal.
    function _pullIn(address from, uint256 amount) internal {
        require(usdc.transferFrom(from, address(this), amount), "transfer failed");
        if (address(yieldAdapter) != address(0)) {
            require(usdc.approve(address(yieldAdapter), amount), "approve failed");
            yieldAdapter.deposit(amount, address(this));
        }
        totalPrincipal += amount;
    }

    /// Send exactly `amount` of principal to `to`, recovering it from the adapter
    /// (if set). Decrements tracked principal.
    function _payOut(address to, uint256 amount) internal {
        if (address(yieldAdapter) != address(0)) {
            yieldAdapter.withdraw(amount, to);
        } else {
            require(usdc.transfer(to, amount), "transfer failed");
        }
        totalPrincipal -= amount;
    }

    /// Sweep accrued yield (adapter balance above principal) to the treasury.
    /// Permissionless — the proceeds only ever go to treasury. No-op when yield
    /// is disabled or nothing has accrued.
    function harvest() external returns (uint256 yield) {
        if (address(yieldAdapter) == address(0)) return 0;
        uint256 held = yieldAdapter.assetsOf(address(this));
        if (held <= totalPrincipal) return 0;
        yield = held - totalPrincipal;
        yieldAdapter.withdraw(yield, treasury);
        emit Harvested(treasury, yield);
    }

    // --- builder stake ---

    /// Builder deposits USDC stake (after `approve`).
    function deposit(uint256 amount) external {
        _pullIn(msg.sender, amount);
        stake[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// Builder withdraws unlocked stake.
    function withdraw(uint256 amount) external {
        require(stake[msg.sender] >= amount, "insufficient free stake");
        stake[msg.sender] -= amount;
        _payOut(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // --- build lifecycle ---

    /// Arbiter assigns a build to a staked builder: locks `bond` from the
    /// builder's free stake and escrows `price` (pulled from the arbiter, who
    /// collected it from the client). The bond's USDC stays supplied (it was
    /// pulled in at deposit); only `price` is newly pulled in here.
    function registerBuild(bytes32 buildId, address builder, uint256 price, uint256 bond)
        external
        onlyArbiter
    {
        require(builds[buildId].status == Status.None, "exists");
        require(bond >= minStake, "bond below min");
        require(stake[builder] >= bond, "insufficient stake");
        _pullIn(msg.sender, price); // escrow the build price
        stake[builder] -= bond;
        builds[buildId] = Build(builder, price, bond, Status.Assigned, 0, address(0), 0);
        emit BuildRegistered(buildId, builder, price, bond);
    }

    /// Arbiter marks delivery (the automated deploy gate passed) → opens the
    /// community challenge window.
    function markDelivered(bytes32 buildId) external onlyArbiter {
        Build storage b = builds[buildId];
        require(b.status == Status.Assigned, "not assigned");
        b.status = Status.Delivered;
        b.deliveredAt = uint64(block.timestamp);
        emit Delivered(buildId, b.deliveredAt);
    }

    /// Community stake-to-challenge during the window. The bond mirrors the
    /// build bond, so a frivolous challenge costs as much as it risks.
    function challenge(bytes32 buildId) external {
        Build storage b = builds[buildId];
        require(b.status == Status.Delivered, "not challengeable");
        require(block.timestamp <= b.deliveredAt + challengeWindow, "window closed");
        require(b.challenger == address(0), "already challenged");
        uint256 cb = b.bond;
        _pullIn(msg.sender, cb);
        b.challenger = msg.sender;
        b.challengeBond = cb;
        emit Challenged(buildId, msg.sender, cb);
    }

    /// Permissionless finalize of a clean, unchallenged delivery after the
    /// window: builder reclaims bond + earns price. No arbiter tx — happy path.
    function finalize(bytes32 buildId) external {
        Build storage b = builds[buildId];
        require(b.status == Status.Delivered, "not delivered");
        require(b.challenger == address(0), "challenged");
        require(block.timestamp > b.deliveredAt + challengeWindow, "window open");
        b.status = Status.Finalized;
        stake[b.builder] += b.bond; // bond returns to free stake (stays supplied)
        _payOut(b.builder, b.price);
        emit Finalized(buildId, b.builder, b.price);
    }

    /// Arbiter ruling — used to slash a failed gate/AI verdict immediately, or to
    /// resolve a challenge. `slashBuilder` true ⇒ bad delivery; false ⇒ good
    /// (any challenge was frivolous).
    function resolve(bytes32 buildId, bool slashBuilder, bool delist) external onlyArbiter {
        Build storage b = builds[buildId];
        require(b.status == Status.Delivered, "not delivered");
        if (slashBuilder) {
            b.status = Status.Slashed;
            // escrowed price always returns to treasury (builder is not paid).
            _payOut(treasury, b.price);
            if (b.challenger == address(0)) {
                // arbiter-initiated slash: builder bond → treasury.
                _payOut(treasury, b.bond);
            } else {
                // upheld challenge: challenger refunded + rewarded with the bond.
                _payOut(b.challenger, b.challengeBond + b.bond);
            }
            emit Slashed(buildId, b.builder, b.bond, delist);
        } else {
            b.status = Status.Finalized;
            stake[b.builder] += b.bond;
            _payOut(b.builder, b.price);
            if (b.challenger != address(0)) {
                // frivolous challenge: bond forfeited to treasury.
                _payOut(treasury, b.challengeBond);
            }
            emit Finalized(buildId, b.builder, b.price);
        }
        emit ChallengeResolved(buildId, slashBuilder);
    }
}
