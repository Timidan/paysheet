// USDC transfers on Base Sepolia. Each transfer's calldata ends with the row's
// screen hash, so the payment on chain points at the screen that preceded it.
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { USDC } from "./screen.mjs";

const abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const transport = http(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
export const publicClient = createPublicClient({ chain: baseSepolia, transport });

export function transferData(row) {
  const call = encodeFunctionData({ abi, functionName: "transfer", args: [row.wallet.toLowerCase(), parseUnits(row.amount, 6)] });
  return call + row.screenHash.slice(2);
}

export function makeDemoPayer(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  return {
    address: account.address,
    async pay(row) {
      const hash = await wallet.sendTransaction({ to: USDC, data: transferData(row) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error("transfer reverted");
      return { tx: hash, from: account.address };
    },
  };
}

// A payment reported by a connected wallet counts only if the chain shows
// exactly this row's transfer with this row's screen hash.
export async function verifyPayment(tx, row) {
  // Wait for the receipt first: a hash that was only just broadcast is not yet readable.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  const t = await publicClient.getTransaction({ hash: tx });
  if (receipt.status !== "success") throw new Error("That transaction failed on chain.");
  if (t.to?.toLowerCase() !== USDC.toLowerCase() || t.input.toLowerCase() !== transferData(row).toLowerCase())
    throw new Error("That transaction is not this row's payment.");
  return { tx, from: t.from };
}
