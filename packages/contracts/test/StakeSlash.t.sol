// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakeSlash} from "../src/StakeSlash.sol";
import {SimpleYieldVault} from "../src/SimpleYieldVault.sol";

/// Minimal mock USDC (6-dec ERC-20) for the escrow tests.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract StakeSlashTest is Test {
    MockUSDC usdc;
    StakeSlash escrow;

    address arbiter = address(0xA11CE);
    address treasury = address(0x7EA5);
    address builder = address(0xB1);
    address challenger = address(0xC1);

    uint256 constant MIN_STAKE = 10e6; // 10 USDC
    uint256 constant WINDOW = 1 days;
    uint256 constant PRICE = 5e6;
    uint256 constant BOND = 10e6;
    bytes32 constant BID = keccak256("bld_test");

    function setUp() public {
        usdc = new MockUSDC();
        // yield disabled (address(0)) — proves behaviour is identical to v1.
        escrow = new StakeSlash(address(usdc), arbiter, treasury, MIN_STAKE, WINDOW, address(0));
        // Fund + stake the builder.
        usdc.mint(builder, 100e6);
        vm.startPrank(builder);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.deposit(BOND);
        vm.stopPrank();
        // Arbiter holds the escrowed price.
        usdc.mint(arbiter, 100e6);
        vm.prank(arbiter);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _register() internal {
        vm.prank(arbiter);
        escrow.registerBuild(BID, builder, PRICE, BOND);
    }

    function test_deposit_locks_free_stake() public view {
        assertEq(escrow.stake(builder), BOND);
    }

    function test_registerBuild_locks_bond_and_escrows_price() public {
        _register();
        assertEq(escrow.stake(builder), 0); // bond locked
        assertEq(usdc.balanceOf(address(escrow)), BOND + PRICE);
    }

    function test_registerBuild_only_arbiter() public {
        vm.expectRevert("not arbiter");
        escrow.registerBuild(BID, builder, PRICE, BOND);
    }

    function test_happy_path_finalize_pays_builder_and_returns_bond() public {
        _register();
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        vm.warp(block.timestamp + WINDOW + 1);
        uint256 before = usdc.balanceOf(builder);
        escrow.finalize(BID); // permissionless
        assertEq(usdc.balanceOf(builder), before + PRICE);
        assertEq(escrow.stake(builder), BOND); // bond reclaimed
    }

    function test_finalize_blocked_during_window() public {
        _register();
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        vm.expectRevert("window open");
        escrow.finalize(BID);
    }

    function test_arbiter_slash_sends_bond_and_price_to_treasury() public {
        _register();
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        vm.prank(arbiter);
        escrow.resolve(BID, true, true); // slash, no challenger
        assertEq(usdc.balanceOf(treasury), BOND + PRICE);
    }

    function test_upheld_challenge_rewards_challenger() public {
        _register();
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        usdc.mint(challenger, BOND);
        vm.startPrank(challenger);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.challenge(BID);
        vm.stopPrank();
        vm.prank(arbiter);
        escrow.resolve(BID, true, true); // upheld: challenger refunded bond + rewarded build bond
        assertEq(usdc.balanceOf(challenger), BOND + BOND);
        assertEq(usdc.balanceOf(treasury), PRICE); // price reclaimed to treasury
    }

    function test_frivolous_challenge_forfeits_to_treasury() public {
        _register();
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        usdc.mint(challenger, BOND);
        vm.startPrank(challenger);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.challenge(BID);
        vm.stopPrank();
        uint256 builderBefore = usdc.balanceOf(builder);
        vm.prank(arbiter);
        escrow.resolve(BID, false, false); // frivolous: builder paid, challenger bond → treasury
        assertEq(usdc.balanceOf(builder), builderBefore + PRICE);
        assertEq(escrow.stake(builder), BOND);
        assertEq(usdc.balanceOf(treasury), BOND); // forfeited challenge bond
    }
}

/// Bounty #1: the YIELD-BEARING escrow. Idle stake + escrowed price sit in the
/// vault; harvest() sweeps accrued yield to the treasury; participant payouts
/// always return EXACT principal (yield is pure platform upside).
contract StakeSlashYieldTest is Test {
    MockUSDC usdc;
    SimpleYieldVault vault;
    StakeSlash escrow;

    address arbiter = address(0xA11CE);
    address treasury = address(0x7EA5);
    address builder = address(0xB1);
    address sponsor = address(0x5); // simulates the lending market's interest

    uint256 constant MIN_STAKE = 10e6;
    uint256 constant WINDOW = 1 days;
    uint256 constant PRICE = 5e6;
    uint256 constant BOND = 10e6;
    bytes32 constant BID = keccak256("bld_yield");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new SimpleYieldVault(address(usdc));
        escrow = new StakeSlash(address(usdc), arbiter, treasury, MIN_STAKE, WINDOW, address(vault));
        usdc.mint(builder, 100e6);
        vm.startPrank(builder);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.deposit(BOND); // → supplied into the vault
        vm.stopPrank();
        usdc.mint(arbiter, 100e6);
        vm.prank(arbiter);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.mint(sponsor, 100e6);
        vm.prank(sponsor);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_idle_funds_are_supplied_to_the_vault() public {
        // Builder's 10 USDC stake lives in the vault, not the escrow.
        assertEq(usdc.balanceOf(address(vault)), BOND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalPrincipal(), BOND);
        assertEq(vault.assetsOf(address(escrow)), BOND);
    }

    function test_harvest_sweeps_only_yield_to_treasury_principal_preserved() public {
        vm.prank(arbiter);
        escrow.registerBuild(BID, builder, PRICE, BOND); // escrows price → vault
        assertEq(escrow.totalPrincipal(), BOND + PRICE); // 15
        // 3 USDC interest accrues in the vault.
        vm.prank(sponsor);
        vault.accrue(3e6);
        assertEq(vault.assetsOf(address(escrow)), 15e6 + 3e6);

        uint256 swept = escrow.harvest();
        assertEq(swept, 3e6);
        assertEq(usdc.balanceOf(treasury), 3e6); // only the yield
        assertEq(escrow.totalPrincipal(), 15e6); // principal untouched
        assertEq(vault.assetsOf(address(escrow)), 15e6);

        // Second harvest is a no-op (nothing accrued).
        assertEq(escrow.harvest(), 0);
    }

    function test_finalize_pays_exact_price_despite_yield() public {
        vm.prank(arbiter);
        escrow.registerBuild(BID, builder, PRICE, BOND);
        vm.prank(sponsor);
        vault.accrue(3e6); // yield accrues before settlement
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        vm.warp(block.timestamp + WINDOW + 1);

        uint256 before = usdc.balanceOf(builder);
        escrow.finalize(BID);
        assertEq(usdc.balanceOf(builder), before + PRICE); // EXACT price, not price+yield
        assertEq(escrow.stake(builder), BOND); // bond reclaimed (still in vault)

        // The yield is still harvestable to treasury afterwards.
        uint256 swept = escrow.harvest();
        assertEq(swept, 3e6);
        assertEq(usdc.balanceOf(treasury), 3e6);
    }

    function test_full_unwind_leaves_vault_empty() public {
        vm.prank(arbiter);
        escrow.registerBuild(BID, builder, PRICE, BOND);
        vm.prank(sponsor);
        vault.accrue(3e6);
        vm.prank(arbiter);
        escrow.markDelivered(BID);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.finalize(BID); // builder paid price; bond back to free stake
        escrow.harvest(); // yield → treasury
        vm.prank(builder);
        escrow.withdraw(BOND); // builder pulls remaining stake
        assertEq(escrow.totalPrincipal(), 0);
        // Only rounding dust (if any) may remain; principal fully returned.
        assertLe(usdc.balanceOf(address(vault)), 1);
    }
}
