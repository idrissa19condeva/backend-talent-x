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

const trainingGroupSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        slug: { type: String, required: true, unique: true, lowercase: true, index: true },
        description: { type: String, trim: true, maxlength: 240 },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        members: { type: [trainingGroupMemberSchema], default: [] },
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

trainingGroupSchema.pre("validate", function setSlug(next) {
    if (this.name) {
        this.slug = toSlug(this.name);
    }
    next();
});

trainingGroupSchema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        if (ret.owner) {
            ret.owner = ret.owner.toString();
        }
        if (Array.isArray(ret.members)) {
            ret.members = ret.members.map((member) => ({
                user: member.user?.toString() || member.user,
                joinedAt: member.joinedAt,
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
