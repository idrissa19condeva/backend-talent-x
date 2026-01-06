const request = require("supertest");
const { createApp } = require("../../app");
const EmailVerification = require("../../models/EmailVerification");

jest.mock("../../services/emailService", () => ({
    sendVerificationCode: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe("/api/auth email code flow", () => {
    test("sends a verification code and stores it", async () => {
        const email = "test@example.com";

        const res = await request(app)
            .post("/api/auth/email-code")
            .send({ email });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true });

        const record = await EmailVerification.findOne({ email });
        expect(record).toBeTruthy();
        expect(record.code).toHaveLength(6);
        expect(record.expiresAt instanceof Date).toBe(true);
    });

    test("verifies a correct code and rejects an incorrect one", async () => {
        const email = "user@example.com";
        await request(app)
            .post("/api/auth/email-code")
            .send({ email })
            .expect(200);

        const record = await EmailVerification.findOne({ email });
        expect(record).toBeTruthy();

        const badAttempt = await request(app)
            .post("/api/auth/email-code/verify")
            .send({ email, code: "000000" });

        expect(badAttempt.status).toBe(400);
        const afterBad = await EmailVerification.findOne({ email });
        expect(afterBad.attempts).toBe(1);

        const goodAttempt = await request(app)
            .post("/api/auth/email-code/verify")
            .send({ email, code: record.code });

        expect(goodAttempt.status).toBe(200);
        expect(goodAttempt.body).toMatchObject({ verified: true });
    });
});
