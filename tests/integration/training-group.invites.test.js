const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../app");
const User = require("../../models/User");

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

describe("training group member invites (integration)", () => {
    test("athlete cannot create a group (coach-only)", async () => {
        const athlete = await createUser({ role: "athlete", firstName: "Athlete", lastName: "Only" });
        const athleteToken = signToken(athlete);

        const res = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${athleteToken}`)
            .send({ name: `Groupe interdit ${Date.now()}` });

        expect(res.status).toBe(403);
        expect((res.body?.message || "").toLowerCase()).toContain("coach");
    });

    test("owner can invite a user; invite appears in /groups/mine; invitee can accept", async () => {
        const owner = await createUser({ role: "coach", firstName: "Owner", lastName: "Coach" });
        const invitee = await createUser({ role: "athlete", firstName: "Invitee", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const inviteeToken = signToken(invitee);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Test ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        const inviteRes = await request(app)
            .post(`/api/groups/${groupId}/members`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ userId: invitee._id.toString() });

        expect(inviteRes.status).toBe(202);
        expect(inviteRes.body?.message).toContain("Invitation");
        expect(Array.isArray(inviteRes.body?.memberInvites)).toBe(true);
        expect(inviteRes.body.memberInvites.some((i) => i.id === invitee._id.toString())).toBe(true);

        const mineRes = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);

        expect(Array.isArray(mineRes.body)).toBe(true);
        const mineGroup = mineRes.body.find((g) => g.id === groupId);
        expect(mineGroup).toBeTruthy();
        expect(mineGroup.isMember).toBe(false);
        expect(mineGroup.hasPendingInvite).toBe(true);

        const acceptRes = await request(app)
            .post(`/api/groups/${groupId}/invites/accept`)
            .set("Authorization", `Bearer ${inviteeToken}`)
            .send({});

        expect(acceptRes.status).toBe(201);
        expect(acceptRes.body?.message).toContain("acceptée");
        expect(acceptRes.body?.isMember).toBe(true);
        expect(acceptRes.body?.hasPendingInvite).toBe(false);
        expect(Array.isArray(acceptRes.body?.members)).toBe(true);
        expect(acceptRes.body.members.some((m) => m.id === invitee._id.toString())).toBe(true);

        const mineAfter = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);

        const groupAfter = mineAfter.body.find((g) => g.id === groupId);
        expect(groupAfter).toBeTruthy();
        expect(groupAfter.isMember).toBe(true);
        expect(groupAfter.hasPendingInvite).toBe(false);
    });

    test("a member can leave a group (self removal) via DELETE /groups/:id/members/:memberId", async () => {
        const owner = await createUser({ role: "coach", firstName: "OwnerLeave", lastName: "Coach" });
        const member = await createUser({ role: "athlete", firstName: "MemberLeave", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const memberToken = signToken(member);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Leave ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        await request(app)
            .post(`/api/groups/${groupId}/members`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ userId: member._id.toString() })
            .expect(202);

        await request(app)
            .post(`/api/groups/${groupId}/invites/accept`)
            .set("Authorization", `Bearer ${memberToken}`)
            .send({})
            .expect(201);

        const leaveRes = await request(app)
            .delete(`/api/groups/${groupId}/members/${member._id.toString()}`)
            .set("Authorization", `Bearer ${memberToken}`)
            .send({});

        expect(leaveRes.status).toBe(200);
        expect(leaveRes.body?.isMember).toBe(false);
        expect(Array.isArray(leaveRes.body?.members)).toBe(true);
        expect(leaveRes.body.members.some((m) => m.id === member._id.toString())).toBe(false);

        const mineAfter = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${memberToken}`)
            .expect(200);

        expect(mineAfter.body.some((g) => g.id === groupId)).toBe(false);
    });

    test("invitee can decline an invite; group disappears from /groups/mine", async () => {
        const owner = await createUser({ role: "coach", firstName: "Owner2", lastName: "Coach" });
        const invitee = await createUser({ role: "athlete", firstName: "Invitee2", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const inviteeToken = signToken(invitee);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Decline ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        await request(app)
            .post(`/api/groups/${groupId}/members`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ userId: invitee._id.toString() })
            .expect(202);

        const mineBefore = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);
        expect(mineBefore.body.some((g) => g.id === groupId && g.hasPendingInvite === true)).toBe(true);

        const declineRes = await request(app)
            .delete(`/api/groups/${groupId}/invites`)
            .set("Authorization", `Bearer ${inviteeToken}`)
            .send({});

        expect(declineRes.status).toBe(200);
        expect(declineRes.body?.message).toContain("refusée");

        const mineAfter = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);

        expect(mineAfter.body.some((g) => g.id === groupId)).toBe(false);
    });

    test("owner can cancel an invite; group disappears from invitee /groups/mine", async () => {
        const owner = await createUser({ role: "coach", firstName: "Owner3", lastName: "Coach" });
        const invitee = await createUser({ role: "athlete", firstName: "Invitee3", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const inviteeToken = signToken(invitee);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe Cancel ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        await request(app)
            .post(`/api/groups/${groupId}/members`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ userId: invitee._id.toString() })
            .expect(202);

        const mineBefore = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);
        expect(mineBefore.body.some((g) => g.id === groupId && g.hasPendingInvite === true)).toBe(true);

        const cancelRes = await request(app)
            .delete(`/api/groups/${groupId}/invites/${invitee._id.toString()}`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({});

        expect(cancelRes.status).toBe(200);
        expect(cancelRes.body?.message).toContain("annulée");

        const mineAfter = await request(app)
            .get("/api/groups/mine")
            .set("Authorization", `Bearer ${inviteeToken}`)
            .expect(200);

        expect(mineAfter.body.some((g) => g.id === groupId)).toBe(false);
    });
});
