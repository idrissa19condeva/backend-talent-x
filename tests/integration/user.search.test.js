const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../app");
const User = require("../../models/User");

const app = createApp();

describe("/api/user/search", () => {
    test("matches by last name and multi-token queries (not only first-name prefix)", async () => {
        const me = await User.create({
            fullName: "Search Owner",
            firstName: "Search",
            lastName: "Owner",
            email: "search.owner@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const target = await User.create({
            fullName: "Idris Benali",
            firstName: "Idris",
            lastName: "Benali",
            username: "ibena",
            email: "idris.benali@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        await User.create({
            fullName: "Alice Martin",
            firstName: "Alice",
            lastName: "Martin",
            username: "amartin",
            email: "alice.martin@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const token = jwt.sign({ id: me._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1h" });

        const resLastName = await request(app)
            .get("/api/user/search")
            .set("Authorization", `Bearer ${token}`)
            .query({ q: "ben" });

        expect(resLastName.status).toBe(200);
        expect(Array.isArray(resLastName.body)).toBe(true);
        expect(resLastName.body.some((u) => u.id === target._id.toString())).toBe(true);

        const resMulti = await request(app)
            .get("/api/user/search")
            .set("Authorization", `Bearer ${token}`)
            .query({ q: "ben idr" });

        expect(resMulti.status).toBe(200);
        expect(resMulti.body.some((u) => u.id === target._id.toString())).toBe(true);

        // Ensure it does not return the current user
        expect(resMulti.body.some((u) => u.id === me._id.toString())).toBe(false);
    });
});
