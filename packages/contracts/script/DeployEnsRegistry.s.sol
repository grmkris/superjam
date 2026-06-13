// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

/// The deployed Durin L2RegistryFactory (same CREATE2 across L2s incl. Base Sepolia).
interface IL2RegistryFactory {
    function deployRegistry(
        string calldata name,
        string memory symbol,
        string memory baseURI,
        address admin
    ) external returns (address);
}

/// Deploy SuperJam's Durin L2Registry on Base Sepolia (ENS track, R3).
///   forge script script/DeployEnsRegistry.s.sol:DeployEnsRegistry \
///     --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $SERVER_WALLET_PRIVATE_KEY --broadcast
/// admin = the server wallet (base-node owner ⇒ can createSubnode + addRegistrar).
contract DeployEnsRegistry is Script {
    address constant FACTORY = 0xDddddDdDDD8Aa1f237b4fa0669cb46892346d22d;

    function run() external returns (address registry) {
        address admin = vm.envAddress("ARBITER");
        vm.startBroadcast();
        registry = IL2RegistryFactory(FACTORY).deployRegistry(
            "superjam.eth",
            "SuperJam Names",
            "https://superjam.fun/ens/",
            admin
        );
        vm.stopBroadcast();
        console.log("L2Registry deployed at:", registry);
        console.log("  admin:", admin);
    }
}
