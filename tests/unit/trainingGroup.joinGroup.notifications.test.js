jest.mock("../../services/inboxNotificationService", () => ({
    createInboxNotificationForUser: jest.fn().mockResolvedValue(null),
    createInboxNotificationsForUsers: jest.fn().mockResolvedValue([]),
}));

const trainingGroupController = require("../../controllers/trainingGroupController");
const { createInboxNotificationForUser } = require("../../services/inboxNotificationService");
const User = require("../../models/User");
const TrainingGroup = require("../../models/TrainingGroup");

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makeUser = async (overrides = {}) => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return User.create({
        fullName: overrides.fullName || "Test User",
        firstName: overrides.firstName || "Test",
        lastName: overrides.lastName || "User",
        username: overrides.username,
        email: overrides.email || `test-${nonce}@example.com`,
        passwordHash: overrides.passwordHash || "hash",
        role: overrides.role || "athlete",
    });
};

describe("trainingGroupController.joinGroup notifications", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("notifies the group owner when a user requests to join", async () => {
        const owner = await makeUser({ role: "coach", fullName: "Coach" });
        const requester = await makeUser({ role: "athlete", fullName: "Alice" });
        const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });

        const req = {
            params: { id: group.id },
            user: { id: requester.id },
        };
        const res = makeRes();

        await trainingGroupController.joinGroup(req, res);

        expect(res.status).toHaveBeenCalledWith(202);
        expect(createInboxNotificationForUser).toHaveBeenCalledTimes(1);

        const [targetUserId, notification] = createInboxNotificationForUser.mock.calls[0];
        expect(targetUserId).toBe(owner.id);
        expect(notification).toMatchObject({
            type: "group_join_requested",
            data: { groupId: group.id, requesterId: requester.id },
        });
        expect(typeof notification.message).toBe("string");
        expect(notification.message).toContain("a demandé à rejoindre le groupe");
    });
});
