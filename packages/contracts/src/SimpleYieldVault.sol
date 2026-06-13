// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "./IYieldAdapter.sol";

/// Minimal ERC-20 surface (USDC/EURC are 6-dec Circle FiatTokens).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// A minimal ERC-4626-style USDC yield vault — the reliable `IYieldAdapter` for
/// any chain (incl. Arc, where Aave/Morpho testnet pools may not be callable).
/// Shares track proportional ownership of the vault's USDC; **yield accrues as
/// the vault's balance grows** (a real lending market grows it automatically;
/// here `accrue` injects interest — funded by the platform/treasury or a sponsor
/// for the demo). `convertToAssets` rises with yield, so `redeem` returns
/// principal + the depositor's pro-rata yield share.
///
/// Single-depositor use (the StakeSlash escrow), so the ERC-4626 first-deposit
/// inflation vector is not in scope.
contract SimpleYieldVault is IYieldAdapter {
    IERC20 public immutable usdc;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    event Deposited(address indexed receiver, uint256 assets, uint256 shares);
    event Redeemed(address indexed owner, address indexed receiver, uint256 shares, uint256 assets);
    event Accrued(address indexed from, uint256 amount);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    /// Total USDC backing all shares (principal + accrued yield).
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 ta = totalAssets();
        if (totalShares == 0 || ta == 0) return assets; // 1:1 bootstrap
        return (assets * totalShares) / ta;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        // Price shares off the pre-deposit pool (standard 4626 ordering).
        shares = convertToShares(assets);
        require(usdc.transferFrom(msg.sender, address(this), assets), "deposit transfer failed");
        totalShares += shares;
        sharesOf[receiver] += shares;
        emit Deposited(receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver) external returns (uint256 assets) {
        require(sharesOf[msg.sender] >= shares, "insufficient shares");
        assets = convertToAssets(shares);
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        require(usdc.transfer(receiver, assets), "redeem transfer failed");
        emit Redeemed(msg.sender, receiver, shares, assets);
    }

    /// Withdraw an exact `assets` amount (the escrow's payout path). Burns the
    /// ceil number of shares so the vault never under-collateralizes; rounding
    /// dust stays as yield for remaining holders.
    function withdraw(uint256 assets, address receiver) external returns (uint256 shares) {
        uint256 ta = totalAssets();
        shares = (ta == 0) ? assets : (assets * totalShares + ta - 1) / ta; // ceil
        require(sharesOf[msg.sender] >= shares, "insufficient shares");
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        require(usdc.transfer(receiver, assets), "withdraw transfer failed");
        emit Redeemed(msg.sender, receiver, shares, assets);
    }

    /// Underlying value currently held for `owner` (principal + accrued yield).
    function assetsOf(address owner) external view returns (uint256) {
        return convertToAssets(sharesOf[owner]);
    }

    /// Inject yield (interest) into the vault — raises the share price for all
    /// holders. In production this is the lending protocol auto-accruing.
    function accrue(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "accrue transfer failed");
        emit Accrued(msg.sender, amount);
    }
}
