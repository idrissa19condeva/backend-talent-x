jest.mock("../../services/inboxNotificationService", () => ({
    createInboxNotificationsForUsers: jest.fn().mockResolvedValue([]),
    createInboxNotificationForUser: jest.fn().mockResolvedValue(null),
}));

const { createInboxNotificationsForUsers } = require("../../services/inboxNotificationService");
const trainingController = require("../../controllers/trainingController");
const User = require("../../models/User");
const TrainingGroup = require("../../models/TrainingGroup");
const TrainingSession = require("../../models/TrainingSession");

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

describe("trainingController.attachSessionToGroup", () => {
    let consoleErrorSpy;

    beforeAll(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
    });

    afterAll(() => {
        if (consoleErrorSpy) {
            consoleErrorSpy.mockRestore();
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates an independent copy in the group and keeps the source session personal", async () => {
        const owner = await makeUser();
        const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });

        const source = await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(2026, 0, 4),
            startTime: "09:00",
            durationMinutes: 60,
            type: "vitesse",
            title: "Séance perso",
            series: [{ id: "s1", segments: [] }],
            participants: [{ user: owner._id, addedBy: owner._id }],
            chronos: [
                {
                    participant: owner._id,
                    seriesId: "s1",
                    seriesIndex: 0,
                    repeatIndex: 0,
                    segmentId: "seg1",
                    segmentIndex: 0,
                    repetitionIndex: 0,
                    time: "12.34",
                },
            ],
        });

        const req = {
            params: { id: group.id },
            body: { sessionId: source.id },
            user: { id: owner.id },
        };
        const res = makeRes();

        await trainingController.attachSessionToGroup(req, res);

        // status 201 when copy is created
        expect([200, 201]).toContain(res.status.mock.calls[0]?.[0] ?? 200);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;

        expect(payload.id).toBeDefined();
        expect(payload.id).not.toBe(source.id);
        expect(payload.groupId).toBe(group.id);
        expect(payload.copiedFromSessionId?.toString?.() || payload.copiedFromSessionId).toBe(source.id);

        // source remains personal
        const storedSource = await TrainingSession.findById(source.id);
        expect(storedSource.group).toBeFalsy();

        // copy is independent and execution data is reset
        const storedCopy = await TrainingSession.findById(payload.id);
        expect(storedCopy.group.toString()).toBe(group.id);
        expect(storedCopy.copiedFromSessionId.toString()).toBe(source.id);
        expect(storedCopy.participants || []).toHaveLength(0);
        expect(storedCopy.chronos || []).toHaveLength(0);

        // content is copied
        expect(storedCopy.title).toBe("Séance perso");
        expect(storedCopy.type).toBe("vitesse");
        expect(storedCopy.startTime).toBe("09:00");
        expect(storedCopy.durationMinutes).toBe(60);

        // Notify group members about the share.
        expect(createInboxNotificationsForUsers).toHaveBeenCalledTimes(1);
        const [memberIds, notification] = createInboxNotificationsForUsers.mock.calls[0];
        expect(memberIds).toEqual([]);
        expect(notification).toMatchObject({
            type: "group_session_shared",
        });
    });

    it("notifies group members when a session is shared", async () => {
        const owner = await makeUser();
        const member = await makeUser();
        const group = await TrainingGroup.create({
            name: "Groupe test",
            owner: owner._id,
            members: [{ user: member._id, joinedAt: new Date() }],
        });

        const source = await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(2026, 0, 4),
            startTime: "09:00",
            durationMinutes: 60,
            type: "vitesse",
            title: "Séance perso",
            series: [{ id: "s1", segments: [] }],
        });

        const req = {
            params: { id: group.id },
            body: { sessionId: source.id },
            user: { id: owner.id },
        };
        const res = makeRes();

        await trainingController.attachSessionToGroup(req, res);

        expect(createInboxNotificationsForUsers).toHaveBeenCalledTimes(1);
        const [memberIds, notification] = createInboxNotificationsForUsers.mock.calls[0];
        expect(memberIds).toEqual([member.id]);
        expect(notification).toMatchObject({
            type: "group_session_shared",
            data: { groupId: group.id },
        });
        expect(notification?.data?.sessionId).toBeTruthy();
        expect(notification?.data?.copiedFromSessionId).toBe(source.id);
    });

    it("notifies group members when a shared session is removed", async () => {
        const owner = await makeUser();
        const member = await makeUser();
        const group = await TrainingGroup.create({
            name: "Groupe test",
            owner: owner._id,
            members: [{ user: member._id, joinedAt: new Date() }],
        });

        const source = await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(2026, 0, 4),
            startTime: "09:00",
            durationMinutes: 60,
            type: "vitesse",
            title: "Séance perso",
            series: [{ id: "s1", segments: [] }],
        });

        const attachReq = { params: { id: group.id }, body: { sessionId: source.id }, user: { id: owner.id } };
        const attachRes = makeRes();
        await trainingController.attachSessionToGroup(attachReq, attachRes);
        const raw = attachRes.json.mock.calls[0][0];
        const created = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;

        jest.clearAllMocks();

        const detachReq = { params: { id: group.id, sessionId: created.id }, user: { id: owner.id } };
        const detachRes = makeRes();
        await trainingController.detachSessionFromGroup(detachReq, detachRes);

        expect(createInboxNotificationsForUsers).toHaveBeenCalledTimes(1);
        const [memberIds, notification] = createInboxNotificationsForUsers.mock.calls[0];
        expect(memberIds).toEqual([member.id]);
        expect(notification).toMatchObject({
            type: "group_session_removed",
            data: { groupId: group.id, sessionId: created.id },
        });
    });

    it("returns the existing copy if the same source was already shared to this group", async () => {
        const owner = await makeUser();
        const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });

        const source = await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(2026, 0, 4),
            startTime: "09:00",
            durationMinutes: 60,
            type: "vitesse",
            title: "Séance perso",
            series: [{ id: "s1", segments: [] }],
        });

        const firstReq = { params: { id: group.id }, body: { sessionId: source.id }, user: { id: owner.id } };
        const firstRes = makeRes();
        await trainingController.attachSessionToGroup(firstReq, firstRes);
        const firstRaw = firstRes.json.mock.calls[0][0];
        const firstPayload = firstRaw && typeof firstRaw.toJSON === "function" ? firstRaw.toJSON() : firstRaw;

        const beforeSecondCall = await TrainingSession.countDocuments();
        const secondReq = { params: { id: group.id }, body: { sessionId: source.id }, user: { id: owner.id } };
        const secondRes = makeRes();
        await trainingController.attachSessionToGroup(secondReq, secondRes);

        expect(secondRes.status).not.toHaveBeenCalledWith(201);
        const secondRaw = secondRes.json.mock.calls[0][0];
        const secondPayload = secondRaw && typeof secondRaw.toJSON === "function" ? secondRaw.toJSON() : secondRaw;
        expect(secondPayload.id).toBe(firstPayload.id);

        const afterSecondCall = await TrainingSession.countDocuments();
        expect(afterSecondCall).toBe(beforeSecondCall);
    });

    test.each([
        [
            "returns 400 when sessionId missing",
            async () => {
                const owner = await makeUser();
                const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });
                const req = { params: { id: group.id }, body: {}, user: { id: owner.id } };
                return { req, expectedStatus: 400, expectedMessage: "Identifiant de la séance requis" };
            },
        ],
        [
            "returns 404 when group not found",
            async () => {
                const owner = await makeUser();
                const source = await TrainingSession.create({
                    athleteId: owner._id,
                    date: new Date(2026, 0, 4),
                    startTime: "09:00",
                    durationMinutes: 60,
                    type: "vitesse",
                    title: "Séance perso",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: "64cfe97f6b6f52b36d111111" },
                    body: { sessionId: source.id },
                    user: { id: owner.id },
                };
                return { req, expectedStatus: 404, expectedMessage: "Groupe introuvable" };
            },
        ],
        [
            "returns 403 when requester is not the group owner",
            async () => {
                const owner = await makeUser();
                const nonOwner = await makeUser();
                const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [{ user: nonOwner._id }] });
                const req = {
                    params: { id: group.id },
                    body: { sessionId: "64cfe97f6b6f52b36d222222" },
                    user: { id: nonOwner.id },
                };
                return { req, expectedStatus: 403, expectedMessage: "Seul le créateur du groupe peut ajouter une séance" };
            },
        ],
        [
            "returns 404 when source session not found",
            async () => {
                const owner = await makeUser();
                const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });
                const req = {
                    params: { id: group.id },
                    body: { sessionId: "64cfe97f6b6f52b36d333333" },
                    user: { id: owner.id },
                };
                return { req, expectedStatus: 404, expectedMessage: "Séance introuvable" };
            },
        ],
        [
            "returns 403 when trying to share someone else's session",
            async () => {
                const owner = await makeUser();
                const other = await makeUser();
                const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });
                const source = await TrainingSession.create({
                    athleteId: other._id,
                    date: new Date(2026, 0, 4),
                    startTime: "09:00",
                    durationMinutes: 60,
                    type: "vitesse",
                    title: "Séance autre",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = { params: { id: group.id }, body: { sessionId: source.id }, user: { id: owner.id } };
                return { req, expectedStatus: 403, expectedMessage: "Vous ne pouvez partager que vos propres séances" };
            },
        ],
        [
            "returns 400 when session already linked to a group",
            async () => {
                const owner = await makeUser();
                const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });
                const source = await TrainingSession.create({
                    athleteId: owner._id,
                    date: new Date(2026, 0, 4),
                    startTime: "09:00",
                    durationMinutes: 60,
                    type: "vitesse",
                    title: "Séance déjà groupe",
                    series: [{ id: "s1", segments: [] }],
                    group: group._id,
                });
                const req = { params: { id: group.id }, body: { sessionId: source.id }, user: { id: owner.id } };
                return { req, expectedStatus: 400, expectedMessage: "Cette séance est déjà liée à un groupe" };
            },
        ],
    ])("%s (does not create any session)", async (_label, setup) => {
        const { req, expectedStatus, expectedMessage } = await setup();
        const before = await TrainingSession.countDocuments();
        const res = makeRes();

        await trainingController.attachSessionToGroup(req, res);

        expect(res.status).toHaveBeenCalledWith(expectedStatus);
        expect(res.json).toHaveBeenCalledWith({ message: expectedMessage });
        const after = await TrainingSession.countDocuments();
        expect(after).toBe(before);
    });
});
