// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StakeSlash} from "../src/StakeSlash.sol";
import {SimpleYieldVault} from "../src/SimpleYieldVault.sol";

/// Deploy the yield-bearing StakeSlash escrow (bounty #1). Default target is ARC.
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $ARC_RPC_URL --private-key $SERVER_WALLET_PRIVATE_KEY --broadcast
///
/// Env:
///   USDC_ADDRESS    USDC (default Arc 0x3600…0000; pass Base Sepolia 0x036C…F7e to retarget)
///   ARBITER         the sole privileged signer (the server wallet address)
///   TREASURY_ADDRESS slash/forfeit + yield recipient
///   MIN_STAKE_USDC, CHALLENGE_WINDOW_SECS (optional, sane defaults)
///   YIELD=0         set to disable the vault (escrow holds funds in-contract)
contract Deploy is Script {
    function run() external returns (StakeSlash escrow, SimpleYieldVault vault) {
        address usdc = vm.envOr(
            "USDC_ADDRESS",
            address(0x3600000000000000000000000000000000000000) // Arc testnet USDC
        );
        address arbiter = vm.envAddress("ARBITER");
        address treasury = vm.envOr("TREASURY_ADDRESS", arbiter);
        uint256 minStake = vm.envOr("MIN_STAKE_USDC", uint256(10_000_000)); // 10 USDC (6-dec)
        uint256 window = vm.envOr("CHALLENGE_WINDOW_SECS", uint256(86_400)); // 24h
        bool yieldOn = vm.envOr("YIELD", uint256(1)) != 0;

        vm.startBroadcast();
        address adapter = address(0);
        if (yieldOn) {
            vault = new SimpleYieldVault(usdc);
            adapter = address(vault);
        }
        escrow = new StakeSlash(usdc, arbiter, treasury, minStake, window, adapter);
        vm.stopBroadcast();

        console.log("StakeSlash deployed at:", address(escrow));
        console.log("  yield vault:", adapter);
        console.log("  arbiter:", arbiter);
        console.log("  treasury:", treasury);
    }
}
