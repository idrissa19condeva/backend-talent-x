const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../app");
const User = require("../../models/User");
const TrainingSession = require("../../models/TrainingSession");

const app = createApp();

const createUser = async (overrides = {}) => {
    const firstName = overrides.firstName || "Test";
    const lastName = overrides.lastName || "User";
    const email = overrides.email || `user.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`;

    return User.create({
        fullName: overrides.fullName || `${firstName} ${lastName}`,
        firstName,
        lastName,
        email,
        passwordHash: await bcrypt.hash(overrides.password || "P@ssw0rd!", 10),
        role: overrides.role || "coach",
    });
};

const signToken = (user) => jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1h" });

describe("training group delete (integration)", () => {
    test("owner can delete a group; sessions get unlinked", async () => {
        const owner = await createUser({ role: "coach", firstName: "OwnerDelete", lastName: "Coach" });
        const ownerToken = signToken(owner);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Delete ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        const session = await TrainingSession.create({
            athleteId: owner._id,
            date: new Date(),
            type: "vitesse",
            title: "Session liée au groupe",
            group: groupId,
        });

        const delRes = await request(app)
            .delete(`/api/groups/${groupId}`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({})
            .expect(200);

        expect(delRes.body?.ok).toBe(true);

        await request(app)
            .get(`/api/groups/${groupId}`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .expect(404);

        const sessionAfter = await TrainingSession.findById(session._id);
        expect(sessionAfter).toBeTruthy();
        expect(sessionAfter.group).toBeUndefined();
    });

    test("non-owner cannot delete a group", async () => {
        const owner = await createUser({ role: "coach", firstName: "OwnerDelete2", lastName: "Coach" });
        const other = await createUser({ role: "athlete", firstName: "OtherDelete2", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const otherToken = signToken(other);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Delete Forbidden ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        const delRes = await request(app)
            .delete(`/api/groups/${groupId}`)
            .set("Authorization", `Bearer ${otherToken}`)
            .send({});

        expect(delRes.status).toBe(403);
        expect(delRes.body?.message).toMatch(/créateur|supprimer/i);
    });
});
