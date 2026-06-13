#!/usr/bin/env bun
import { createPublicClient, http, keccak256, encodePacked, toHex, toFunctionSelector } from "viem";
import { baseSepolia } from "viem/chains";

const reg = process.env.ENS_L2_REGISTRY as `0x${string}`;
const parentNode = process.env.ENS_PARENT_NODE as `0x${string}`;
const rpc = process.env.BASE_SEPOLIA_RPC_URL;
const SENDER = "0x56592bA38D41370Fc0ebb43a02274709084c9904";

const c = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const ABI = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
const subnode = (parent: `0x${string}`, label: string) =>
  keccak256(encodePacked(["bytes32", "bytes32"], [parent, keccak256(toHex(label))]));
const userNode = subnode(parentNode, "kristjangrm1");

console.log("registry:", reg);
console.log("sender (ENS server wallet):", SENDER);
for (const [name, node] of [["superjam.eth (parent)", parentNode], ["kristjangrm1 (user)", userNode]] as const) {
  try {
    const o = await c.readContract({ address: reg, abi: ABI, functionName: "owner", args: [node] });
    console.log(`owner ${name}: ${o}${o.toLowerCase() === SENDER.toLowerCase() ? "  <-- our wallet" : ""}`);
  } catch (e) {
    console.log(`owner ${name}: ERR ${String(e).slice(0, 90)}`);
  }
}

console.log("\nmatch error selector 0xe66c48da:");
for (const sig of [
  "Unauthorized()", "Unauthorised()", "Unauthorized(bytes32)", "Unauthorized(bytes32,address)",
  "Forbidden()", "NotAuthorized()", "Unauthorized(address)", "LabelTooShort()",
  "SubnodeAlreadyExists()", "NodeAlreadyExists()", "AlreadyRegistered()",
]) {
  try {
    const sel = toFunctionSelector(sig);
    console.log(`  ${sel} ${sig}${sel === "0xe66c48da" ? "  <-- MATCH" : ""}`);
  } catch {}
}
