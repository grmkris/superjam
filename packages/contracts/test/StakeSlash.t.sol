// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakeSlash} from "../src/StakeSlash.sol";

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
        escrow = new StakeSlash(address(usdc), arbiter, treasury, MIN_STAKE, WINDOW);
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
