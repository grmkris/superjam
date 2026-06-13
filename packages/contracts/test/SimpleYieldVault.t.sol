// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SimpleYieldVault} from "../src/SimpleYieldVault.sol";

/// Minimal 6-dec mock token (distinct name from StakeSlash.t.sol's mock to avoid
/// artifact-name collisions).
contract TestUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        require(balanceOf[msg.sender] >= a, "bal");
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(balanceOf[f] >= a, "bal");
        require(allowance[f][msg.sender] >= a, "allow");
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }
}

contract SimpleYieldVaultTest is Test {
    TestUSDC usdc;
    SimpleYieldVault vault;
    address escrow = address(0xE5C0);
    address alice = address(0xA1);
    address sponsor = address(0x5);

    function setUp() public {
        usdc = new TestUSDC();
        vault = new SimpleYieldVault(address(usdc));
        usdc.mint(escrow, 1_000_000_000); // 1000 USDC
        usdc.mint(sponsor, 1_000_000_000);
        vm.prank(escrow);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(sponsor);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_deposit_bootstraps_1to1() public {
        vm.prank(escrow);
        uint256 shares = vault.deposit(100_000_000, escrow); // 100 USDC
        assertEq(shares, 100_000_000);
        assertEq(vault.totalAssets(), 100_000_000);
        assertEq(vault.convertToAssets(shares), 100_000_000);
    }

    function test_yield_raises_share_price_redeem_returns_principal_plus_yield() public {
        vm.prank(escrow);
        uint256 shares = vault.deposit(100_000_000, escrow); // 100 USDC principal
        // 10 USDC of interest accrues into the vault.
        vm.prank(sponsor);
        vault.accrue(10_000_000);
        assertEq(vault.convertToAssets(shares), 110_000_000); // 110 USDC now
        vm.prank(escrow);
        uint256 got = vault.redeem(shares, escrow);
        assertEq(got, 110_000_000); // principal 100 + yield 10
    }

    function test_two_depositors_split_yield_pro_rata() public {
        usdc.mint(alice, 1_000_000_000);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(escrow);
        uint256 sEscrow = vault.deposit(100_000_000, escrow); // 100
        vm.prank(alice);
        uint256 sAlice = vault.deposit(300_000_000, alice); // 300 (→ 3x shares)

        // 40 USDC yield on a 400 pool → escrow +10, alice +30.
        vm.prank(sponsor);
        vault.accrue(40_000_000);

        assertEq(vault.convertToAssets(sEscrow), 110_000_000);
        assertEq(vault.convertToAssets(sAlice), 330_000_000);
    }

    function test_redeem_more_than_owned_reverts() public {
        vm.prank(escrow);
        uint256 shares = vault.deposit(100_000_000, escrow);
        vm.prank(escrow);
        vm.expectRevert("insufficient shares");
        vault.redeem(shares + 1, escrow);
    }
}
