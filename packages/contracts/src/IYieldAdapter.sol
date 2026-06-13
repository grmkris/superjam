// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Yield-adapter seam so the StakeSlash escrow can park idle stake + escrowed
/// build prices in a yield source while funds are locked, and reclaim principal +
/// accrued yield on settlement (Circle/Arc bounty #1 "advanced stablecoin logic").
/// Two implementations behind one seam: `SimpleYieldVault` (our own — reliable on
/// any chain incl. Arc) and a future Aave/Morpho adapter (drop-in if a pool is
/// callable). The escrow is the sole depositor; it tracks its own principal, so
/// `assetsOf(escrow) - principal` is yield → treasury.
interface IYieldAdapter {
    /// The underlying asset (USDC/EURC).
    function asset() external view returns (address);

    /// Pull `assets` from msg.sender, credit msg.sender's position. Returns shares.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// Send exactly `assets` underlying to `receiver`, burning msg.sender's shares.
    function withdraw(uint256 assets, address receiver) external returns (uint256 shares);

    /// Current underlying value held for `owner` (principal + accrued yield).
    function assetsOf(address owner) external view returns (uint256);
}
