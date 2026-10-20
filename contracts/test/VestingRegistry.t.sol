// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VestingRegistry} from "../src/VestingRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";

contract VestingRegistryTest is Test {
    MockERC20 token;
    VestingRegistry registry;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");

    bytes32 constant ID = bytes32("team-001");
    uint64 constant START = 1_000_000;
    uint64 constant CLIFF = 100;
    uint64 constant DURATION = 1_000;
    uint256 constant AMOUNT = 1_000e18;

    event ScheduleCreated(
        bytes32 indexed allocationId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint64 start,
        uint64 cliffDuration,
        uint64 duration
    );
    event ScheduleFunded(bytes32 indexed allocationId, address indexed funder, uint256 amount);
    event TokensReleased(bytes32 indexed allocationId, address indexed beneficiary, uint256 amount);

    function setUp() public {
        token = new MockERC20();
        registry = new VestingRegistry(token, admin);
        token.mint(admin, 1_000_000e18);
        vm.prank(admin);
        token.approve(address(registry), type(uint256).max);
    }

    function _create(bytes32 id, address who, uint256 amount) internal {
        vm.prank(admin);
        registry.createSchedule(id, who, amount, START, CLIFF, DURATION);
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(VestingRegistry.ZeroAddress.selector);
        new VestingRegistry(IERC20(address(0)), admin);
        vm.expectRevert(VestingRegistry.ZeroAddress.selector);
        new VestingRegistry(token, address(0));
    }

    function test_constructor_grantsRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SCHEDULE_MANAGER_ROLE(), admin));
        assertEq(address(registry.token()), address(token));
    }

    // ---------------------------------------------------------------- creation

    function test_create_storesScheduleAndPullsFunds() public {
        vm.expectEmit(address(registry));
        emit ScheduleCreated(ID, alice, AMOUNT, START, CLIFF, DURATION);
        vm.expectEmit(address(registry));
        emit ScheduleFunded(ID, admin, AMOUNT);
        _create(ID, alice, AMOUNT);

        VestingRegistry.Schedule memory s = registry.getSchedule(ID);
        assertEq(s.beneficiary, alice);
        assertEq(s.totalAmount, AMOUNT);
        assertEq(s.start, START);
        assertEq(s.cliffDuration, CLIFF);
        assertEq(s.duration, DURATION);
        assertEq(s.released, 0);
        assertEq(token.balanceOf(address(registry)), AMOUNT);
        assertEq(registry.totalOutstanding(), AMOUNT);
        assertEq(registry.scheduleCount(), 1);
        assertEq(registry.allocationIdAt(0), ID);
    }

    function test_create_revertsForUnauthorizedCaller() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, mallory, registry.SCHEDULE_MANAGER_ROLE()
            )
        );
        vm.prank(mallory);
        registry.createSchedule(ID, alice, AMOUNT, START, CLIFF, DURATION);
    }

    function test_create_grantedManagerCanCreate() public {
        token.mint(bob, AMOUNT);
        bytes32 role = registry.SCHEDULE_MANAGER_ROLE();
        vm.prank(admin);
        registry.grantRole(role, bob);
        vm.startPrank(bob);
        token.approve(address(registry), AMOUNT);
        registry.createSchedule(ID, alice, AMOUNT, START, CLIFF, DURATION);
        vm.stopPrank();
        assertEq(registry.getSchedule(ID).beneficiary, alice);
    }

    function test_create_revertsOnInvalidInputs() public {
        vm.startPrank(admin);
        vm.expectRevert(VestingRegistry.InvalidAllocationId.selector);
        registry.createSchedule(bytes32(0), alice, AMOUNT, START, CLIFF, DURATION);
        vm.expectRevert(VestingRegistry.ZeroAddress.selector);
        registry.createSchedule(ID, address(0), AMOUNT, START, CLIFF, DURATION);
        vm.expectRevert(VestingRegistry.InvalidAmount.selector);
        registry.createSchedule(ID, alice, 0, START, CLIFF, DURATION);
        vm.expectRevert(VestingRegistry.InvalidDuration.selector);
        registry.createSchedule(ID, alice, AMOUNT, START, 0, 0);
        vm.expectRevert(VestingRegistry.CliffExceedsDuration.selector);
        registry.createSchedule(ID, alice, AMOUNT, START, DURATION + 1, DURATION);
        vm.stopPrank();
    }

    function test_create_revertsOnDuplicateId() public {
        _create(ID, alice, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(VestingRegistry.AllocationExists.selector, ID));
        _create(ID, bob, AMOUNT);
    }

    function test_create_revertsWhenFundingInsufficient() public {
        address poor = makeAddr("poor");
        bytes32 role = registry.SCHEDULE_MANAGER_ROLE();
        vm.prank(admin);
        registry.grantRole(role, poor);
        vm.startPrank(poor);
        token.approve(address(registry), AMOUNT);
        vm.expectRevert(); // ERC20InsufficientBalance
        registry.createSchedule(ID, alice, AMOUNT, START, CLIFF, DURATION);
        vm.stopPrank();
        assertEq(registry.scheduleCount(), 0);
    }

    function test_create_revertsForFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        VestingRegistry r = new VestingRegistry(IERC20(address(fot)), admin);
        fot.mint(admin, AMOUNT);
        vm.startPrank(admin);
        fot.approve(address(r), AMOUNT);
        vm.expectRevert(VestingRegistry.UnsupportedToken.selector);
        r.createSchedule(ID, alice, AMOUNT, START, CLIFF, DURATION);
        vm.stopPrank();
    }

    function test_create_revertsWhenTokenReturnsFalse() public {
        ReturnsFalseToken bad = new ReturnsFalseToken();
        VestingRegistry r = new VestingRegistry(IERC20(address(bad)), admin);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        vm.prank(admin);
        r.createSchedule(ID, alice, AMOUNT, START, CLIFF, DURATION);
    }

    function test_view_revertsForUnknownAllocation() public {
        vm.expectRevert(abi.encodeWithSelector(VestingRegistry.UnknownAllocation.selector, ID));
        registry.getSchedule(ID);
        vm.expectRevert(abi.encodeWithSelector(VestingRegistry.UnknownAllocation.selector, ID));
        registry.releasable(ID);
    }

    // ---------------------------------------------------------------- vesting boundaries

    function test_vested_boundaries() public {
        _create(ID, alice, AMOUNT);
        assertEq(registry.vestedAmount(ID, START - 1), 0, "before start");
        assertEq(registry.vestedAmount(ID, START), 0, "at start");
        assertEq(registry.vestedAmount(ID, START + CLIFF - 1), 0, "just before cliff");
        assertEq(registry.vestedAmount(ID, START + CLIFF), AMOUNT * CLIFF / DURATION, "exactly at cliff");
        assertEq(registry.vestedAmount(ID, START + DURATION / 2), AMOUNT / 2, "midpoint");
        assertEq(registry.vestedAmount(ID, START + DURATION - 1), AMOUNT * (DURATION - 1) / DURATION, "just before end");
        assertEq(registry.vestedAmount(ID, START + DURATION), AMOUNT, "at end");
        assertEq(registry.vestedAmount(ID, type(uint64).max), AMOUNT, "far future");
    }

    function test_vested_noCliffStartsLinearAtStart() public {
        vm.prank(admin);
        registry.createSchedule(ID, alice, AMOUNT, START, 0, DURATION);
        assertEq(registry.vestedAmount(ID, START), 0);
        assertEq(registry.vestedAmount(ID, START + 1), AMOUNT / DURATION);
    }

    function test_vested_cliffEqualsDurationIsAllAtEnd() public {
        vm.prank(admin);
        registry.createSchedule(ID, alice, AMOUNT, START, DURATION, DURATION);
        assertEq(registry.vestedAmount(ID, START + DURATION - 1), 0);
        assertEq(registry.vestedAmount(ID, START + DURATION), AMOUNT);
    }

    function test_vested_roundsDown() public {
        vm.prank(admin);
        registry.createSchedule(ID, alice, 10, START, 0, 3);
        assertEq(registry.vestedAmount(ID, START + 1), 3); // 10 * 1 / 3 = 3.33 -> 3
        assertEq(registry.vestedAmount(ID, START + 2), 6);
        assertEq(registry.vestedAmount(ID, START + 3), 10);
    }

    // ---------------------------------------------------------------- release

    function test_release_beforeCliffReverts() public {
        _create(ID, alice, AMOUNT);
        vm.warp(START + CLIFF - 1);
        assertEq(registry.releasable(ID), 0);
        vm.expectRevert(VestingRegistry.NothingToRelease.selector);
        vm.prank(alice);
        registry.release(ID);
    }

    function test_release_transfersVestedAmount() public {
        _create(ID, alice, AMOUNT);
        vm.warp(START + DURATION / 2);
        vm.expectEmit(address(registry));
        emit TokensReleased(ID, alice, AMOUNT / 2);
        vm.prank(alice);
        uint256 released = registry.release(ID);
        assertEq(released, AMOUNT / 2);
        assertEq(token.balanceOf(alice), AMOUNT / 2);
        assertEq(registry.getSchedule(ID).released, AMOUNT / 2);
        assertEq(registry.totalOutstanding(), AMOUNT / 2);
    }

    function test_release_repeatedClaims() public {
        _create(ID, alice, AMOUNT);
        vm.warp(START + 250);
        vm.prank(alice);
        registry.release(ID);

        // Immediately claiming again yields nothing.
        vm.expectRevert(VestingRegistry.NothingToRelease.selector);
        vm.prank(alice);
        registry.release(ID);

        vm.warp(START + 600);
        vm.prank(alice);
        registry.release(ID);
        vm.warp(START + DURATION + 5);
        vm.prank(alice);
        registry.release(ID);

        assertEq(token.balanceOf(alice), AMOUNT);
        assertEq(registry.releasable(ID), 0);
        assertEq(token.balanceOf(address(registry)), 0);
        assertEq(registry.totalOutstanding(), 0);
    }

    function test_release_onlyBeneficiary() public {
        _create(ID, alice, AMOUNT);
        vm.warp(START + DURATION);
        vm.expectRevert(VestingRegistry.NotBeneficiary.selector);
        vm.prank(mallory);
        registry.release(ID);
        vm.expectRevert(VestingRegistry.NotBeneficiary.selector);
        vm.prank(admin);
        registry.release(ID);
    }

    function test_release_unknownAllocation() public {
        vm.expectRevert(abi.encodeWithSelector(VestingRegistry.UnknownAllocation.selector, ID));
        vm.prank(alice);
        registry.release(ID);
    }

    function test_multipleSchedulesAreIsolated() public {
        bytes32 id2 = bytes32("team-002");
        bytes32 id3 = bytes32("advisor-001");
        _create(ID, alice, AMOUNT);
        _create(id2, alice, 2 * AMOUNT);
        _create(id3, bob, 3 * AMOUNT);
        vm.warp(START + DURATION);

        vm.prank(alice);
        registry.release(id2);
        assertEq(token.balanceOf(alice), 2 * AMOUNT);
        assertEq(registry.releasable(ID), AMOUNT, "other alice schedule untouched");
        assertEq(registry.releasable(id3), 3 * AMOUNT, "bob untouched");

        vm.expectRevert(VestingRegistry.NotBeneficiary.selector);
        vm.prank(alice);
        registry.release(id3);
        assertEq(registry.scheduleCount(), 3);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_vestedIsMonotonicAndBounded(uint256 amount, uint64 cliff, uint64 duration, uint64 t1, uint64 t2)
        public
    {
        amount = bound(amount, 1, 1e30);
        duration = uint64(bound(duration, 1, 10 * 365 days));
        cliff = uint64(bound(cliff, 0, duration));
        token.mint(admin, amount);
        vm.prank(admin);
        registry.createSchedule(ID, alice, amount, START, cliff, duration);

        if (t1 > t2) (t1, t2) = (t2, t1);
        uint256 v1 = registry.vestedAmount(ID, t1);
        uint256 v2 = registry.vestedAmount(ID, t2);
        assertLe(v1, v2, "monotonic");
        assertLe(v2, amount, "bounded by allocation");
        if (t2 < START + cliff) assertEq(v2, 0, "zero before cliff");
        if (uint256(t1) >= uint256(START) + duration) assertEq(v1, amount, "full after end");
    }

    function testFuzz_releaseNeverExceedsVested(uint256 amount, uint64 cliff, uint64 duration, uint32[4] memory steps)
        public
    {
        amount = bound(amount, 1, 1e30);
        duration = uint64(bound(duration, 1, 4 * 365 days));
        cliff = uint64(bound(cliff, 0, duration));
        token.mint(admin, amount);
        vm.prank(admin);
        registry.createSchedule(ID, alice, amount, START, cliff, duration);

        uint256 t = START;
        for (uint256 i; i < steps.length; ++i) {
            t += steps[i] % (duration + 1);
            vm.warp(t);
            if (registry.releasable(ID) > 0) {
                vm.prank(alice);
                registry.release(ID);
            }
            uint256 released = registry.getSchedule(ID).released;
            assertLe(released, registry.vestedAmount(ID, uint64(t)));
            assertEq(token.balanceOf(alice), released);
            assertEq(token.balanceOf(address(registry)), amount - released);
        }
    }
}
