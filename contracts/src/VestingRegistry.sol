// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VestingRegistry
/// @notice Holds many linear vesting schedules (with an optional cliff) for a single ERC-20 token.
/// Each schedule is keyed by an operator-chosen `allocationId` so that off-chain records (CSV rows)
/// can be reconciled against on-chain state. Schedules are fully funded at creation time.
/// @dev Portfolio prototype for local development. Not audited. See docs/decisions/0001-vesting-contract.md.
contract VestingRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SCHEDULE_MANAGER_ROLE = keccak256("SCHEDULE_MANAGER_ROLE");

    struct Schedule {
        address beneficiary;
        uint64 start;
        uint64 cliffDuration;
        uint64 duration;
        uint256 totalAmount;
        uint256 released;
    }

    IERC20 public immutable token;

    /// @notice Sum of (totalAmount - released) across all schedules; tokens owed to beneficiaries.
    uint256 public totalOutstanding;

    mapping(bytes32 allocationId => Schedule) private _schedules;
    bytes32[] private _allocationIds;

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

    error ZeroAddress();
    error InvalidAllocationId();
    error AllocationExists(bytes32 allocationId);
    error UnknownAllocation(bytes32 allocationId);
    error InvalidAmount();
    error InvalidDuration();
    error CliffExceedsDuration();
    error NotBeneficiary();
    error NothingToRelease();
    error UnsupportedToken();

    constructor(IERC20 token_, address admin) {
        if (address(token_) == address(0) || admin == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SCHEDULE_MANAGER_ROLE, admin);
    }

    /// @notice Create and fully fund a vesting schedule. Pulls `totalAmount` tokens from the caller.
    function createSchedule(
        bytes32 allocationId,
        address beneficiary,
        uint256 totalAmount,
        uint64 start,
        uint64 cliffDuration,
        uint64 duration
    ) external nonReentrant onlyRole(SCHEDULE_MANAGER_ROLE) {
        if (allocationId == bytes32(0)) revert InvalidAllocationId();
        if (_schedules[allocationId].beneficiary != address(0)) revert AllocationExists(allocationId);
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert InvalidAmount();
        if (duration == 0) revert InvalidDuration();
        if (cliffDuration > duration) revert CliffExceedsDuration();

        // Effects
        _schedules[allocationId] = Schedule({
            beneficiary: beneficiary,
            start: start,
            cliffDuration: cliffDuration,
            duration: duration,
            totalAmount: totalAmount,
            released: 0
        });
        _allocationIds.push(allocationId);
        totalOutstanding += totalAmount;

        emit ScheduleCreated(allocationId, beneficiary, totalAmount, start, cliffDuration, duration);

        // Interaction: pull funds and reject fee-on-transfer / rebasing-on-transfer behaviour.
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        // forge-lint: disable-next-line(incorrect-strict-equality) -- exact equality is the point of this check
        if (token.balanceOf(address(this)) - balanceBefore != totalAmount) revert UnsupportedToken();

        emit ScheduleFunded(allocationId, msg.sender, totalAmount);
    }

    /// @notice Release all currently vested, unreleased tokens of a schedule to its beneficiary.
    /// @dev Only the beneficiary may trigger a release.
    function release(bytes32 allocationId) external nonReentrant returns (uint256 amount) {
        Schedule storage s = _schedules[allocationId];
        if (s.beneficiary == address(0)) revert UnknownAllocation(allocationId);
        if (msg.sender != s.beneficiary) revert NotBeneficiary();

        // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds cannot overflow for ~5.8e11 years
        amount = _vested(s, uint64(block.timestamp)) - s.released;
        if (amount == 0) revert NothingToRelease();

        s.released += amount;
        totalOutstanding -= amount;

        emit TokensReleased(allocationId, s.beneficiary, amount);
        token.safeTransfer(s.beneficiary, amount);
    }

    /// @notice Amount vested at `timestamp` (independent of what has been released).
    /// @dev Boundaries: 0 before `start + cliffDuration`; linear (floor) from then on; full at `start + duration`.
    function vestedAmount(bytes32 allocationId, uint64 timestamp) external view returns (uint256) {
        return _vested(_get(allocationId), timestamp);
    }

    /// @notice Amount the beneficiary could release right now.
    function releasable(bytes32 allocationId) external view returns (uint256) {
        Schedule storage s = _get(allocationId);
        // forge-lint: disable-next-line(unsafe-typecast) -- see release()
        return _vested(s, uint64(block.timestamp)) - s.released;
    }

    function getSchedule(bytes32 allocationId) external view returns (Schedule memory) {
        return _get(allocationId);
    }

    function scheduleCount() external view returns (uint256) {
        return _allocationIds.length;
    }

    function allocationIdAt(uint256 index) external view returns (bytes32) {
        return _allocationIds[index];
    }

    function _get(bytes32 allocationId) private view returns (Schedule storage s) {
        s = _schedules[allocationId];
        if (s.beneficiary == address(0)) revert UnknownAllocation(allocationId);
    }

    function _vested(Schedule storage s, uint64 timestamp) private view returns (uint256) {
        uint256 t = timestamp;
        uint256 start = s.start;
        if (t < start + s.cliffDuration) return 0;
        if (t >= start + s.duration) return s.totalAmount;
        return (s.totalAmount * (t - start)) / s.duration;
    }
}
