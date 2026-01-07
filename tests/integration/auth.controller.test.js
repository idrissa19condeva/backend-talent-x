const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createApp } = require("../../app");
const User = require("../../models/User");
const EmailVerification = require("../../models/EmailVerification");

jest.mock("../../services/emailService", () => ({
    sendVerificationCode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/ffaService", () => ({
    fetchFfaByName: jest.fn().mockResolvedValue({
        resultsByYear: {},
        recordsByEvent: {},
        licenseVerified: true,
        licenseCheckFailed: false,
    }),
}));

const app = createApp();
const { fetchFfaByName } = require("../../services/ffaService");

const buildUserPayload = (overrides = {}) => ({
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    password: "P@ssw0rd!",
    birthDate: "2000-01-01",
    gender: "female",
    role: "coach",
    ...overrides,
});

const ttlMinutes = Number(process.env.EMAIL_CODE_TTL_MINUTES || 10);
const maxAttempts = Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5);

const createVerifiedEmail = async (email, { minutesAgo = 0 } = {}) => {
    const ts = Date.now() - minutesAgo * 60 * 1000;
    return EmailVerification.create({
        email,
        code: "999999",
        expiresAt: new Date(ts + ttlMinutes * 60 * 1000),
        attempts: 0,
        verifiedAt: new Date(ts),
    });
};

describe("authController integration", () => {
    test("checkLicense returns exists when a licenseNumber is present", async () => {
        await User.create({
            fullName: "Licensed User",
            firstName: "Licensed",
            lastName: "User",
            email: "licensed@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
            licenseNumber: "12345",
        });

        const yes = await request(app).get("/api/auth/check-license").query({ licenseNumber: "12 345" });
        expect(yes.status).toBe(200);
        expect(yes.body).toEqual({ exists: true });

        const no = await request(app).get("/api/auth/check-license").query({ licenseNumber: "99999" });
        expect(no.status).toBe(200);
        expect(no.body).toEqual({ exists: false });
    });
    test("checkEmail returns exists when a user is present", async () => {
        await User.create({
            fullName: "Ada Lovelace",
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const res = await request(app).get("/api/auth/check-email").query({ email: "ada@example.com" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ exists: true });
    });

    test("checkEmail is case-insensitive", async () => {
        await User.create({
            fullName: "Case User",
            firstName: "Case",
            lastName: "User",
            email: "CaseUser@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const res = await request(app).get("/api/auth/check-email").query({ email: "caseuser@EXAMPLE.com" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ exists: true });
    });

    test("requestEmailCode rejects missing email", async () => {
        const res = await request(app).post("/api/auth/email-code").send({});

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("email");
    });

    test("requestEmailCode rejects already used email", async () => {
        await User.create({
            fullName: "Existing User",
            firstName: "Existing",
            lastName: "User",
            email: "used@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const res = await request(app).post("/api/auth/email-code").send({ email: "used@example.com" });

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("déjà");
    });

    test("verifyEmailCode rejects missing fields", async () => {
        const res = await request(app).post("/api/auth/email-code/verify").send({});

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("requis");
    });

    test("verifyEmailCode blocks when max attempts reached", async () => {
        await EmailVerification.create({
            email: "blocked@example.com",
            code: "123456",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            attempts: Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5),
        });

        const res = await request(app)
            .post("/api/auth/email-code/verify")
            .send({ email: "blocked@example.com", code: "123456" });

        expect(res.status).toBe(429);
        expect(res.body?.message?.toLowerCase?.()).toContain("trop de tentatives");
    });

    test("verifyEmailCode returns expired when code is too old", async () => {
        await EmailVerification.create({
            email: "late@example.com",
            code: "111111",
            expiresAt: new Date(Date.now() - 1 * 60 * 1000),
            attempts: 0,
        });

        const res = await request(app)
            .post("/api/auth/email-code/verify")
            .send({ email: "late@example.com", code: "111111" });

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("expir");
    });

    test("verifyEmailCode decrements remaining attempts on wrong code", async () => {
        await EmailVerification.create({
            email: "attempts@example.com",
            code: "222222",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            attempts: maxAttempts - 2,
        });

        const res = await request(app)
            .post("/api/auth/email-code/verify")
            .send({ email: "attempts@example.com", code: "000000" });

        expect(res.status).toBe(400);
        expect(res.body?.remainingAttempts).toBe(1);
        const record = await EmailVerification.findOne({ email: "attempts@example.com" });
        expect(record.attempts).toBe(maxAttempts - 1);
    });

    test("requestEmailCode overwrites code and resets attempts on resend", async () => {
        const email = "resend@example.com";
        await request(app).post("/api/auth/email-code").send({ email }).expect(200);
        const first = await EmailVerification.findOne({ email });
        expect(first.attempts).toBe(0);

        await EmailVerification.updateOne({ email }, { $set: { attempts: 3 } });

        await request(app).post("/api/auth/email-code").send({ email }).expect(200);
        const second = await EmailVerification.findOne({ email });
        expect(second.code).not.toBe(first.code);
        expect(second.attempts).toBe(0);
    });

    test("requestEmailCode stores a 6-digit numeric code", async () => {
        const email = "length@example.com";
        await request(app).post("/api/auth/email-code").send({ email }).expect(200);
        const record = await EmailVerification.findOne({ email });
        expect(record.code).toHaveLength(6);
        expect(/^[0-9]{6}$/.test(record.code)).toBe(true);
    });

    test("signup fails when email not verified", async () => {
        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "noval@example.com" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("email not verified".toLowerCase());
    });

    test("signup fails when verification is too old", async () => {
        await createVerifiedEmail("stale@example.com", { minutesAgo: ttlMinutes + 1 });

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "stale@example.com" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("email not verified".toLowerCase());
    });

    test("signup fails when email already exists", async () => {
        await User.create({
            fullName: "Existing User",
            firstName: "Existing",
            lastName: "User",
            email: "dupe@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        await createVerifiedEmail("dupe@example.com");

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "dupe@example.com" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("déjà");
    });

    test("signup athlete fails without license", async () => {
        await createVerifiedEmail("athlete@example.com");

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "athlete@example.com", role: "athlete", licenseNumber: "" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("licence");
    });

    test("signup fails with invalid gender", async () => {
        await createVerifiedEmail("gender@example.com");

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "gender@example.com", gender: "unknown" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("genre");
    });

    test("signup fails with invalid birthDate", async () => {
        await createVerifiedEmail("birth@example.com");

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "birth@example.com", birthDate: "not-a-date" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("date de naissance".toLowerCase());
    });

    test("signup athlete fails when license mismatch", async () => {
        await createVerifiedEmail("mismatch@example.com");
        fetchFfaByName.mockResolvedValueOnce({
            resultsByYear: {},
            recordsByEvent: {},
            licenseVerified: false,
            licenseCheckFailed: false,
        });

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "mismatch@example.com", role: "athlete", licenseNumber: "12345" }));

        expect(res.status).toBe(400);
        expect(res.body?.message?.toLowerCase?.()).toContain("licence");
    });

    test("signup athlete fails when license check fails upstream", async () => {
        await createVerifiedEmail("checkfail@example.com");
        fetchFfaByName.mockResolvedValueOnce({
            resultsByYear: {},
            recordsByEvent: {},
            licenseVerified: false,
            licenseCheckFailed: true,
        });

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "checkfail@example.com", role: "athlete", licenseNumber: "12345" }));

        expect(res.status).toBe(502);
        expect(res.body?.message?.toLowerCase?.()).toContain("impossible de vérifier");
    });

    test("signup athlete fails when FFA returns no result", async () => {
        await createVerifiedEmail("noffa@example.com");
        fetchFfaByName.mockResolvedValueOnce(null);

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "noffa@example.com", role: "athlete", licenseNumber: "12345" }));

        expect(res.status).toBe(502);
        expect(res.body?.message?.toLowerCase?.()).toContain("impossible de récupérer");
    });

    test("signup athlete succeeds when license is verified", async () => {
        await createVerifiedEmail("okathlete@example.com");
        fetchFfaByName.mockResolvedValueOnce({
            resultsByYear: {},
            recordsByEvent: {},
            licenseVerified: true,
            licenseCheckFailed: false,
        });

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "okathlete@example.com", role: "athlete", licenseNumber: "12345" }));

        expect(res.status).toBe(201);
        expect(res.body?.user?.email).toBe("okathlete@example.com");
        expect(res.body?.token).toBeTruthy();
        expect(res.body?.refreshToken).toBeTruthy();
    });

    test("signup athlete rejects duplicate licenseNumber", async () => {
        await createVerifiedEmail("first@example.com");
        await createVerifiedEmail("second@example.com");

        const first = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({
                email: "first@example.com",
                role: "athlete",
                licenseNumber: "12 345",
            }));
        expect(first.status).toBe(201);

        const second = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({
                email: "second@example.com",
                role: "athlete",
                licenseNumber: "12345",
            }));

        expect(second.status).toBe(409);
        expect(second.body?.message?.toLowerCase?.()).toContain("licence");
    });

    test("signup succeeds for a verified coach", async () => {
        await EmailVerification.create({
            email: "coach@example.com",
            code: "654321",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            attempts: 0,
            verifiedAt: new Date(),
        });

        const res = await request(app)
            .post("/api/auth/signup")
            .send(buildUserPayload({ email: "coach@example.com", role: "coach" }));

        expect(res.status).toBe(201);
        expect(res.body?.token).toBeTruthy();
        expect(res.body?.refreshToken).toBeTruthy();
        expect(res.body?.user?.email).toBe("coach@example.com");
        expect(res.body?.user?.passwordHash).toBeUndefined();
    });

    test("login rejects wrong password and accepts the correct one", async () => {
        await User.create({
            fullName: "Login User",
            firstName: "Login",
            lastName: "User",
            email: "login@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const bad = await request(app)
            .post("/api/auth/login")
            .send({ email: "login@example.com", password: "badpass" });
        expect(bad.status).toBe(400);

        const good = await request(app)
            .post("/api/auth/login")
            .send({ email: "login@example.com", password: "P@ssw0rd!" });

        expect(good.status).toBe(200);
        expect(good.body?.token).toBeTruthy();
        expect(good.body?.refreshToken).toBeTruthy();
        expect(good.body?.user?.passwordHash).toBeUndefined();
    });

    test("login rejects missing email and unknown user", async () => {
        const missing = await request(app).post("/api/auth/login").send({ password: "x" });
        expect(missing.status).toBe(400);

        const unknown = await request(app).post("/api/auth/login").send({ email: "nouser@example.com", password: "x" });
        expect(unknown.status).toBe(400);
        expect(unknown.body?.message?.toLowerCase?.()).toContain("introuvable");
    });

    test("refresh rejects invalid token and returns new tokens when valid", async () => {
        const invalid = await request(app).post("/api/auth/refresh").send({ refreshToken: "not-a-token" });
        expect(invalid.status).toBe(401);

        const user = await User.create({
            fullName: "Refresh User",
            firstName: "Refresh",
            lastName: "User",
            email: "refresh@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({ email: user.email, password: "P@ssw0rd!" });

        const refreshRes = await request(app)
            .post("/api/auth/refresh")
            .send({ refreshToken: loginRes.body.refreshToken });

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body?.token).toBeTruthy();
        expect(refreshRes.body?.refreshToken).toBeTruthy();
        const decoded = jwt.verify(refreshRes.body.token, process.env.JWT_SECRET);
        expect(decoded.id).toBe(String(user._id));
    });

    test("refresh rejects token signed with a different secret", async () => {
        const user = await User.create({
            fullName: "Other Secret",
            firstName: "Other",
            lastName: "Secret",
            email: "other@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const forged = jwt.sign({ id: user._id }, "wrong-secret", { expiresIn: "1h" });
        const res = await request(app).post("/api/auth/refresh").send({ refreshToken: forged });
        expect(res.status).toBe(401);
    });

    test("refresh rejects expired token", async () => {
        const user = await User.create({
            fullName: "Expired Refresh",
            firstName: "Expired",
            lastName: "Refresh",
            email: "expired@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const expired = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: -1 });
        const res = await request(app).post("/api/auth/refresh").send({ refreshToken: expired });
        expect(res.status).toBe(401);
    });

    test("refresh rejects token when user no longer exists", async () => {
        const user = await User.create({
            fullName: "Gone User",
            firstName: "Gone",
            lastName: "User",
            email: "gone@example.com",
            passwordHash: await bcrypt.hash("P@ssw0rd!", 10),
        });

        const token = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: "1h" });
        await User.deleteOne({ _id: user._id });

        const res = await request(app).post("/api/auth/refresh").send({ refreshToken: token });
        expect(res.status).toBe(401);
    });
});
