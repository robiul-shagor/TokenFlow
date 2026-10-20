// Hand-maintained ABI subset for contracts/src/VestingRegistry.sol and the ERC-20 calls the app needs.
// `abi.test.ts` checks these against the Foundry build artifact when it is present.

export const vestingRegistryAbi = [
  {
    type: "function",
    name: "createSchedule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "allocationId", type: "bytes32" },
      { name: "beneficiary", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "start", type: "uint64" },
      { name: "cliffDuration", type: "uint64" },
      { name: "duration", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "allocationId", type: "bytes32" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "releasable",
    stateMutability: "view",
    inputs: [{ name: "allocationId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "vestedAmount",
    stateMutability: "view",
    inputs: [
      { name: "allocationId", type: "bytes32" },
      { name: "timestamp", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSchedule",
    stateMutability: "view",
    inputs: [{ name: "allocationId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "beneficiary", type: "address" },
          { name: "start", type: "uint64" },
          { name: "cliffDuration", type: "uint64" },
          { name: "duration", type: "uint64" },
          { name: "totalAmount", type: "uint256" },
          { name: "released", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "SCHEDULE_MANAGER_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "ScheduleCreated",
    inputs: [
      { name: "allocationId", type: "bytes32", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "start", type: "uint64", indexed: false },
      { name: "cliffDuration", type: "uint64", indexed: false },
      { name: "duration", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ScheduleFunded",
    inputs: [
      { name: "allocationId", type: "bytes32", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TokensReleased",
    inputs: [
      { name: "allocationId", type: "bytes32", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InvalidAllocationId", inputs: [] },
  { type: "error", name: "AllocationExists", inputs: [{ name: "allocationId", type: "bytes32" }] },
  { type: "error", name: "UnknownAllocation", inputs: [{ name: "allocationId", type: "bytes32" }] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidDuration", inputs: [] },
  { type: "error", name: "CliffExceedsDuration", inputs: [] },
  { type: "error", name: "NotBeneficiary", inputs: [] },
  { type: "error", name: "NothingToRelease", inputs: [] },
  { type: "error", name: "UnsupportedToken", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address" },
      { name: "neededRole", type: "bytes32" },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
