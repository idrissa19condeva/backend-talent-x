const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { createApp } = require("../../app");
const User = require("../../models/User");
const TrainingGroup = require("../../models/TrainingGroup");
const TrainingTemplate = require("../../models/TrainingTemplate");
const TrainingBlock = require("../../models/TrainingBlock");
const TrainingSession = require("../../models/TrainingSession");

const app = createApp();

const makeUser = async (overrides = {}) => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return User.create({
        fullName: overrides.fullName || "Test User",
        firstName: overrides.firstName || "Test",
        lastName: overrides.lastName || "User",
        email: overrides.email || `test-${nonce}@example.com`,
        passwordHash: overrides.passwordHash || (await bcrypt.hash("P@ssw0rd!", 10)),
        role: overrides.role || "athlete",
        ...overrides,
    });
};

describe("DELETE /api/user/delete cascade", () => {
    test("deletes owned data and removes references", async () => {
        const owner = await makeUser({
            email: "owner@example.com",
            fullName: "Owner User",
            firstName: "Owner",
            lastName: "User",
        });
        const other = await makeUser({
            email: "other@example.com",
            fullName: "Other User",
            firstName: "Other",
            lastName: "User",
        });

        // Owned group (should be deleted)
        await TrainingGroup.create({ name: "Groupe Owner", owner: owner._id, members: [] });

        // Other group referencing the owner (should be cleaned)
        await TrainingGroup.create({
            name: "Groupe Other",
            owner: other._id,
            members: [{ user: owner._id }],
            memberInvites: [{ user: other._id, invitedBy: owner._id }],
            joinRequests: [{ user: owner._id }],
        });

        // Owned template/block/session (should be deleted)
        await TrainingTemplate.create({
            ownerId: owner._id,
            title: "Template 1",
            type: "vitesse",
            series: [{ id: "series-1", segments: [] }],
            visibility: "private",
            version: 1,
        });

        await TrainingBlock.create({
            ownerId: owner._id,
            title: "Block 1",
            segment: { distance: 100, restInterval: 60, blockType: "vitesse" },
            version: 1,
        });

        await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(),
            type: "vitesse",
            title: "Séance owner",
            series: [],
            startTime: "10:00",
            durationMinutes: 60,
        });

        // Friend references in other user should be cleaned
        other.friends = [owner._id];
        await other.save();

        const token = jwt.sign({ id: owner._id.toString() }, process.env.JWT_SECRET);
        const res = await request(app)
            .delete("/api/user/delete")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body?.message?.toLowerCase?.()).toContain("supprim");

        expect(await User.findById(owner._id)).toBeNull();
        expect(await TrainingGroup.countDocuments({ owner: owner._id })).toBe(0);
        expect(await TrainingTemplate.countDocuments({ ownerId: owner._id })).toBe(0);
        expect(await TrainingBlock.countDocuments({ ownerId: owner._id })).toBe(0);
        expect(await TrainingSession.countDocuments({ athleteId: owner._id })).toBe(0);

        const cleanedGroup = await TrainingGroup.findOne({ owner: other._id, name: "Groupe Other" });
        expect(cleanedGroup).toBeTruthy();
        expect((cleanedGroup.members || []).some((m) => String(m.user) === String(owner._id))).toBe(false);
        expect((cleanedGroup.joinRequests || []).some((r) => String(r.user) === String(owner._id))).toBe(false);
        expect((cleanedGroup.memberInvites || []).some((i) => String(i.invitedBy) === String(owner._id))).toBe(false);

        const reloadedOther = await User.findById(other._id);
        expect((reloadedOther.friends || []).map(String)).not.toContain(String(owner._id));
    });
});
