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
        role: overrides.role || "athlete",
    });
};

const signToken = (user) => jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1h" });

describe("acceptance notifications (integration)", () => {
    test("friend request acceptance creates a notification for the requester", async () => {
        const requester = await createUser({ role: "athlete", firstName: "Req", lastName: "User" });
        const accepter = await createUser({ role: "athlete", firstName: "Acc", lastName: "User" });
        const requesterToken = signToken(requester);
        const accepterToken = signToken(accepter);

        await request(app)
            .post(`/api/user/${accepter._id.toString()}/friend-request`)
            .set("Authorization", `Bearer ${requesterToken}`)
            .send({})
            .expect(201);

        await request(app)
            .post(`/api/user/${requester._id.toString()}/friend-request/respond`)
            .set("Authorization", `Bearer ${accepterToken}`)
            .send({ action: "accept" })
            .expect(200);

        const notifRes = await request(app)
            .get("/api/user/me/notifications")
            .set("Authorization", `Bearer ${requesterToken}`)
            .expect(200);

        expect(Array.isArray(notifRes.body)).toBe(true);
        expect(notifRes.body.length).toBeGreaterThan(0);
        expect(notifRes.body[0].type).toBe("friend_request_accepted");
        expect(String(notifRes.body[0].message || "").toLowerCase()).toContain("accept");
    });

    test("group join request acceptance creates a notification for the requesting user", async () => {
        const owner = await createUser({ role: "coach", firstName: "Owner", lastName: "Coach" });
        const requester = await createUser({ role: "athlete", firstName: "Join", lastName: "Athlete" });
        const ownerToken = signToken(owner);
        const requesterToken = signToken(requester);

        const groupRes = await request(app)
            .post("/api/groups")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `Groupe JoinNotif ${Date.now()}` })
            .expect(201);

        const groupId = groupRes.body?.id;
        expect(groupId).toBeTruthy();

        await request(app)
            .post(`/api/groups/${groupId}/join`)
            .set("Authorization", `Bearer ${requesterToken}`)
            .send({})
            .expect(202);

        await request(app)
            .post(`/api/groups/${groupId}/requests/${requester._id.toString()}/accept`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({})
            .expect(200);

        const notifRes = await request(app)
            .get("/api/user/me/notifications")
            .set("Authorization", `Bearer ${requesterToken}`)
            .expect(200);

        expect(Array.isArray(notifRes.body)).toBe(true);
        expect(notifRes.body.some((n) => n.type === "group_join_accepted" && n.data?.groupId === groupId)).toBe(true);
    });
});
