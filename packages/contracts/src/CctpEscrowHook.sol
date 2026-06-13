// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal USDC surface (the ERC-20 view of Arc native USDC, §15).
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// CCTP V2 MessageTransmitter — validates an attested message + mints USDC.
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation)
        external
        returns (bool);
}

/// The SuperJam escrow (StakeSlash) — we only need its cross-chain deposit hook.
interface IStakeSlash {
    function depositFor(address builder, uint256 amount) external;
    function usdc() external view returns (address);
}

/// CctpEscrowHook — the CCTP V2 *destination receiver* (Arc) that turns a
/// cross-chain USDC burn into an atomic builder-stake deposit (Circle #2, "Arc
/// as a liquidity hub"). CCTP core does NOT execute hooks — hookData is opaque
/// metadata carried in the signed burn message; this contract IS the integrator's
/// hook executor.
///
/// Flow: a client on ANY CCTP chain calls
///   TokenMessengerV2.depositForBurnWithHook(
///     amount, destDomain=26 (Arc), mintRecipient = address(this),
///     burnToken, destinationCaller=0, maxFee, minFinality,
///     hookData = abi.encode(address builder))
/// Once Iris attests, anyone calls `relay(message, attestation)`:
///   receiveMessage mints USDC to this contract → we read the minted delta →
///   decode `builder` from the message's hookData → depositFor(builder, minted).
/// Trustless: the builder comes from the SIGNED burn message, not the caller —
/// so "fund a build from any chain into the Arc marketplace in one tx".
contract CctpEscrowHook {
    IMessageTransmitterV2 public immutable messageTransmitter;
    IStakeSlash public immutable stakeSlash;
    IERC20 public immutable usdc;

    /// Offset in the full CCTP message where BurnMessageV2 `hookData` begins:
    /// 148-byte MessageV2 header + 228-byte fixed BurnMessageV2 body = 376
    /// (verified on-chain against a real Arc-bound message, 2026-06-13).
    uint256 internal constant HOOK_DATA_OFFSET = 376;

    event HookDeposited(address indexed builder, uint256 amount);

    constructor(address _messageTransmitter, address _stakeSlash) {
        messageTransmitter = IMessageTransmitterV2(_messageTransmitter);
        stakeSlash = IStakeSlash(_stakeSlash);
        usdc = IERC20(IStakeSlash(_stakeSlash).usdc());
    }

    /// Relay an attested CCTP message (mintRecipient = this, hookData =
    /// abi.encode(builder)). Mints USDC here, then atomically stakes it for the
    /// builder named in the burn message. Returns the credited builder + amount.
    function relay(bytes calldata message, bytes calldata attestation)
        external
        returns (address builder, uint256 minted)
    {
        require(message.length >= HOOK_DATA_OFFSET + 32, "no hookData");
        uint256 balBefore = usdc.balanceOf(address(this));
        require(
            messageTransmitter.receiveMessage(message, attestation),
            "receiveMessage failed"
        );
        minted = usdc.balanceOf(address(this)) - balBefore;
        require(minted > 0, "nothing minted");

        builder = abi.decode(message[HOOK_DATA_OFFSET:], (address));
        require(builder != address(0), "zero builder");

        require(usdc.approve(address(stakeSlash), minted), "approve failed");
        stakeSlash.depositFor(builder, minted);
        emit HookDeposited(builder, minted);
    }
}
