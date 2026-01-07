const mongoose = require("mongoose");

const trainingGroupMemberSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        joinedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const toSlug = (value = "") =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");

const toNameKey = (value = "") => value.toString().trim().toLowerCase();

const trainingGroupSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        nameKey: { type: String, required: true, select: false },
        slug: { type: String, required: true, unique: true, lowercase: true, index: true },
        description: { type: String, trim: true, maxlength: 240 },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        members: { type: [trainingGroupMemberSchema], default: [] },
        memberInvites: {
            type: [
                {
                    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                    invitedAt: { type: Date, default: Date.now },
                    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                },
            ],
            default: [],
        },
        joinRequests: {
            type: [
                {
                    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                    requestedAt: { type: Date, default: Date.now },
                },
            ],
            default: [],
        },
    },
    { timestamps: true }
);

trainingGroupSchema.index({ nameKey: 1 }, { unique: true, sparse: true });

trainingGroupSchema.pre("validate", async function setKeys() {
    if (!this.name) return;

    this.nameKey = toNameKey(this.name);

    const baseSlug = toSlug(this.name) || "group";
    let candidate = baseSlug;
    let counter = 2;

    while (
        await this.constructor.exists({
            slug: candidate,
            _id: { $ne: this._id },
        })
    ) {
        candidate = `${baseSlug}-${counter}`;
        counter += 1;
    }

    this.slug = candidate;
});

trainingGroupSchema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.slug;
        delete ret.nameKey;
        if (ret.owner) {
            ret.owner = ret.owner.toString();
        }
        if (Array.isArray(ret.members)) {
            ret.members = ret.members.map((member) => ({
                user: member.user?.toString() || member.user,
                joinedAt: member.joinedAt,
            }));
        }
        if (Array.isArray(ret.memberInvites)) {
            ret.memberInvites = ret.memberInvites.map((invite) => ({
                user: invite.user?.toString() || invite.user,
                invitedAt: invite.invitedAt,
                invitedBy: invite.invitedBy?.toString() || invite.invitedBy,
            }));
        }
        if (Array.isArray(ret.joinRequests)) {
            ret.joinRequests = ret.joinRequests.map((req) => ({
                user: req.user?.toString() || req.user,
                requestedAt: req.requestedAt,
            }));
        }
        return ret;
    },
});

module.exports = mongoose.model("TrainingGroup", trainingGroupSchema);
