const TrainingGroup = require("../../models/TrainingGroup");
const User = require("../../models/User");

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

describe("TrainingGroup name uniqueness", () => {
    it("enforces case-insensitive uniqueness (Couloir V == couloir v)", async () => {
        const owner = await makeUser();

        await TrainingGroup.create({ name: "Couloir V", owner: owner._id, members: [] });

        await expect(
            TrainingGroup.create({ name: "couloir v", owner: owner._id, members: [] })
        ).rejects.toMatchObject({ code: 11000 });
    });

    it("enforces global uniqueness (different owners cannot reuse the same name)", async () => {
        const owner1 = await makeUser();
        const owner2 = await makeUser();

        await TrainingGroup.create({ name: "Couloir V", owner: owner1._id, members: [] });

        await expect(
            TrainingGroup.create({ name: "couloir v", owner: owner2._id, members: [] })
        ).rejects.toMatchObject({ code: 11000 });
    });

    it("keeps hyphen vs space distinct (couloir v != couloir-v) and keeps slug unique", async () => {
        const owner = await makeUser();

        const first = await TrainingGroup.create({ name: "couloir v", owner: owner._id, members: [] });
        const second = await TrainingGroup.create({ name: "couloir-v", owner: owner._id, members: [] });

        expect(first.name).toBe("couloir v");
        expect(second.name).toBe("couloir-v");

        // Both names should coexist
        expect(first.id).not.toBe(second.id);

        // Slug collisions are resolved by suffixing.
        expect(first.slug).toBe("couloir-v");
        expect(second.slug).toMatch(/^couloir-v-\d+$/);
    });

    it("does not expose internal keys in toJSON", async () => {
        const owner = await makeUser();
        const group = await TrainingGroup.create({ name: "Groupe test", owner: owner._id, members: [] });

        const json = group.toJSON();
        expect(json.name).toBe("Groupe test");
        expect(json.nameKey).toBeUndefined();
        expect(json.slug).toBeUndefined();
    });
});
