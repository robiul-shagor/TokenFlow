// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VestingRegistry} from "../src/VestingRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Drives random create / release / warp sequences against the registry.
contract Handler is Test {
    VestingRegistry public registry;
    MockERC20 public token;
    address public admin;

    address[] public actors;
    bytes32[] public ids;
    uint256 public ghostReleasedTotal;
    mapping(address => uint256) public ghostReceived;
    uint256 public foreignReleaseSuccesses;

    constructor(VestingRegistry registry_, MockERC20 token_, address admin_) {
        registry = registry_;
        token = token_;
        admin = admin_;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 actorSeed, uint256 amount, uint64 cliff, uint64 duration, uint32 startOffset) external {
        if (ids.length >= 20) return;
        amount = bound(amount, 1, 1e27);
        duration = uint64(bound(duration, 1, 365 days));
        cliff = uint64(bound(cliff, 0, duration));
        address who = actors[actorSeed % actors.length];
        bytes32 id = keccak256(abi.encode(ids.length));
        token.mint(admin, amount);
        vm.prank(admin);
        registry.createSchedule(id, who, amount, uint64(block.timestamp) + startOffset % 30 days, cliff, duration);
        ids.push(id);
    }

    function release(uint256 idSeed, uint256 callerSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        address caller = actors[callerSeed % actors.length];
        VestingRegistry.Schedule memory s = registry.getSchedule(id);
        vm.prank(caller);
        try registry.release(id) returns (uint256 amount) {
            if (caller != s.beneficiary) foreignReleaseSuccesses++;
            ghostReleasedTotal += amount;
            ghostReceived[s.beneficiary] += amount;
        } catch {}
    }

    function warp(uint32 delta) external {
        vm.warp(block.timestamp + delta % 60 days);
    }
}

contract VestingRegistryInvariantTest is Test {
    VestingRegistry registry;
    MockERC20 token;
    Handler handler;
    address admin = makeAddr("admin");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockERC20();
        registry = new VestingRegistry(token, admin);
        handler = new Handler(registry, token, admin);
        vm.prank(admin);
        token.approve(address(registry), type(uint256).max);
        targetContract(address(handler));
    }

    /// Cumulative release per schedule never exceeds its vested amount (and therefore its allocation).
    function invariant_releasedNeverExceedsVested() public view {
        for (uint256 i; i < handler.idsLength(); ++i) {
            bytes32 id = handler.ids(i);
            VestingRegistry.Schedule memory s = registry.getSchedule(id);
            assertLe(s.released, registry.vestedAmount(id, uint64(block.timestamp)));
            assertLe(s.released, s.totalAmount);
        }
    }

    /// The registry is always solvent: its balance covers every outstanding obligation.
    function invariant_solvent() public view {
        uint256 outstanding;
        for (uint256 i; i < handler.idsLength(); ++i) {
            VestingRegistry.Schedule memory s = registry.getSchedule(handler.ids(i));
            outstanding += s.totalAmount - s.released;
        }
        assertEq(registry.totalOutstanding(), outstanding);
        assertGe(token.balanceOf(address(registry)), outstanding);
    }

    /// Nobody can release a schedule they are not the beneficiary of.
    function invariant_noForeignRelease() public view {
        assertEq(handler.foreignReleaseSuccesses(), 0);
    }

    /// Tokens only ever leave the registry to beneficiaries, and exactly as recorded.
    function invariant_releaseAccounting() public view {
        uint256 sumReleased;
        for (uint256 i; i < handler.idsLength(); ++i) {
            sumReleased += registry.getSchedule(handler.ids(i)).released;
        }
        assertEq(sumReleased, handler.ghostReleasedTotal());
    }
}
