// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StakeSlash} from "../src/StakeSlash.sol";
import {SimpleYieldVault} from "../src/SimpleYieldVault.sol";
import {CctpEscrowHook} from "../src/CctpEscrowHook.sol";

/// Deploy the CCTP-hook stack on Arc (bounty #2 — atomic cross-chain stake):
/// a fresh yield-bearing StakeSlash (now exposing `depositFor`) + the
/// CctpEscrowHook wired to the live CCTP V2 MessageTransmitter. Lets a burn on
/// any CCTP chain (mintRecipient = the hook, hookData = abi.encode(builder))
/// mint + atomically stake into the Arc marketplace in one cross-chain action.
///   forge script script/DeployCctpHook.s.sol:DeployCctpHook \
///     --rpc-url $ARC_RPC_URL --private-key $SERVER_WALLET_PRIVATE_KEY --broadcast
contract DeployCctpHook is Script {
    /// CCTP V2 MessageTransmitterV2 — same CREATE2 address on every chain.
    address constant MESSAGE_TRANSMITTER =
        0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    function run()
        external
        returns (StakeSlash escrow, SimpleYieldVault vault, CctpEscrowHook hook)
    {
        address usdc = vm.envOr(
            "USDC_ADDRESS",
            address(0x3600000000000000000000000000000000000000)
        );
        address arbiter = vm.envAddress("ARBITER");
        address treasury = vm.envOr("TREASURY_ADDRESS", arbiter);
        uint256 minStake = vm.envOr("MIN_STAKE_USDC", uint256(10_000_000));
        uint256 window = vm.envOr("CHALLENGE_WINDOW_SECS", uint256(86_400));

        vm.startBroadcast();
        vault = new SimpleYieldVault(usdc);
        escrow = new StakeSlash(
            usdc,
            arbiter,
            treasury,
            minStake,
            window,
            address(vault)
        );
        hook = new CctpEscrowHook(MESSAGE_TRANSMITTER, address(escrow));
        vm.stopBroadcast();

        console.log("StakeSlash:", address(escrow));
        console.log("SimpleYieldVault:", address(vault));
        console.log("CctpEscrowHook:", address(hook));
    }
}
