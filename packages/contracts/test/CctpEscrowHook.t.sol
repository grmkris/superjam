// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakeSlash} from "../src/StakeSlash.sol";
import {CctpEscrowHook} from "../src/CctpEscrowHook.sol";

/// Minimal mock USDC (6-dec), mirrors test/StakeSlash.t.sol.
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

/// Mock CCTP MessageTransmitter: receiveMessage mints `mintAmount` USDC to the
/// caller (the hook IS the burn's mintRecipient, so it calls in as msg.sender).
contract MockMessageTransmitter {
    MockUSDC public usdc;
    uint256 public mintAmount;

    constructor(MockUSDC _usdc) {
        usdc = _usdc;
    }

    function setMint(uint256 a) external {
        mintAmount = a;
    }

    function receiveMessage(bytes calldata, bytes calldata) external returns (bool) {
        usdc.mint(msg.sender, mintAmount);
        return true;
    }
}

contract CctpEscrowHookTest is Test {
    MockUSDC usdc;
    StakeSlash escrow;
    MockMessageTransmitter mt;
    CctpEscrowHook hook;

    address arbiter = address(0xA11CE);
    address treasury = address(0x7EA5);
    address builder = address(0xB1);
    uint256 constant MINT = 7e6; // 7 USDC minted cross-chain

    function setUp() public {
        usdc = new MockUSDC();
        // yield disabled — minted USDC lands directly in the escrow.
        escrow = new StakeSlash(address(usdc), arbiter, treasury, 1e6, 1 days, address(0));
        mt = new MockMessageTransmitter(usdc);
        hook = new CctpEscrowHook(address(mt), address(escrow));
        mt.setMint(MINT);
    }

    /// A CCTP message whose hookData (at offset 376) = abi.encode(b). The first
    /// 376 bytes (header + fixed BurnMessageV2 body) are irrelevant to the hook.
    function _msg(address b) internal pure returns (bytes memory) {
        return abi.encodePacked(new bytes(376), bytes32(uint256(uint160(b))));
    }

    function test_relay_mints_and_credits_builder_stake() public {
        (address gotBuilder, uint256 minted) = hook.relay(_msg(builder), "");
        assertEq(gotBuilder, builder);
        assertEq(minted, MINT);
        assertEq(escrow.stake(builder), MINT); // credited the builder, not the hook
        assertEq(escrow.stake(address(hook)), 0);
        assertEq(usdc.balanceOf(address(escrow)), MINT); // yield off → held in escrow
        assertEq(usdc.balanceOf(address(hook)), 0); // swept through
    }

    function test_constructor_reads_usdc_from_escrow() public view {
        assertEq(address(hook.usdc()), address(usdc));
        assertEq(address(hook.stakeSlash()), address(escrow));
    }

    function test_relay_rejects_message_without_hookdata() public {
        vm.expectRevert("no hookData");
        hook.relay(new bytes(100), "");
    }

    function test_relay_rejects_zero_builder() public {
        vm.expectRevert("zero builder");
        hook.relay(_msg(address(0)), "");
    }

    function test_relay_reverts_when_nothing_minted() public {
        mt.setMint(0);
        vm.expectRevert("nothing minted");
        hook.relay(_msg(builder), "");
    }
}
