// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StakeSlash} from "../src/StakeSlash.sol";

/// Deploy StakeSlash to Base Sepolia (P-Contracts / M8).
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $SERVER_WALLET_PRIVATE_KEY --broadcast
///
/// Env:
///   USDC_ADDRESS    Base Sepolia USDC (default Circle 0x036C…F7e)
///   ARBITER         the sole privileged signer (the server wallet address)
///   TREASURY_ADDRESS slash/forfeit recipient
///   MIN_STAKE_USDC, CHALLENGE_WINDOW_SECS (optional, sane defaults)
contract Deploy is Script {
    function run() external returns (StakeSlash escrow) {
        address usdc = vm.envOr(
            "USDC_ADDRESS",
            address(0x036CbD53842c5426634e7929541eC2318f3dCF7e) // Base Sepolia USDC
        );
        address arbiter = vm.envAddress("ARBITER");
        address treasury = vm.envOr("TREASURY_ADDRESS", arbiter);
        uint256 minStake = vm.envOr("MIN_STAKE_USDC", uint256(10_000_000)); // 10 USDC (6-dec)
        uint256 window = vm.envOr("CHALLENGE_WINDOW_SECS", uint256(86_400)); // 24h

        vm.startBroadcast();
        escrow = new StakeSlash(usdc, arbiter, treasury, minStake, window);
        vm.stopBroadcast();

        console.log("StakeSlash deployed at:", address(escrow));
        console.log("  arbiter:", arbiter);
        console.log("  treasury:", treasury);
    }
}
