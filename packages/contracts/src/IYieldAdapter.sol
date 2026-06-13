// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Yield-adapter seam (an ERC-4626 subset) so the StakeSlash escrow can park idle
/// stake + escrowed build prices in a yield source while funds are locked, and
/// reclaim principal + accrued yield on settlement (bounty #1 "advanced
/// programmable logic"). Two implementations behind one interface:
///   - SimpleYieldVault — our own, reliable on ANY chain incl. Arc (where an
///     Aave/Morpho testnet pool may not be callable);
///   - an Aave/Morpho adapter — a drop-in if a pool is live on the target chain.
/// The escrow is the sole depositor: it holds shares and tracks its own principal,
/// so anything above principal at redeem time is yield → treasury.
interface IYieldAdapter {
    /// The underlying asset (USDC/EURC).
    function asset() external view returns (address);

    /// Pull `assets` from msg.sender, credit `receiver` with shares. Returns shares minted.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// Burn `shares` from msg.sender, send the underlying assets to `receiver`. Returns assets sent.
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);

    /// Current asset value of `shares` (principal + accrued yield).
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
}
