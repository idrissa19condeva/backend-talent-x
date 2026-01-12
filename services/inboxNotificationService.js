const User = require("../models/User");
const { sendExpoPush } = require("./expoPushService");

const toObjectIdString = (value) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value._id) return value._id.toString();
    return value.toString();
};

const clampMessage = (message, maxLen = 200) => {
    const raw = typeof message === "string" ? message.trim() : "";
    if (!raw) return "";
    if (raw.length <= maxLen) return raw;
    return `${raw.slice(0, maxLen - 1)}…`;
};

const trySendInboxPush = async (userId, notificationDoc) => {
    try {
        const resolvedUserId = toObjectIdString(userId);
        if (!resolvedUserId) return;

        // expoPushTokens is select:false -> always re-fetch explicitly.
        const user = await User.findById(resolvedUserId).select("expoPushTokens notificationsEnabled status");
        if (!user) return;
        if (user.status && user.status !== "active") return;
        if (!user.notificationsEnabled) return;

        const tokens = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
        if (!tokens.length) return;

        const body = typeof notificationDoc?.message === "string" ? notificationDoc.message : "";
        await sendExpoPush({
            tokens,
            title: "Talent-X",
            body,
            data: {
                kind: "inbox",
                notificationType: notificationDoc?.type,
                notificationId: notificationDoc?._id?.toString?.(),
                ...(notificationDoc?.data || {}),
            },
        });
    } catch (e) {
        // Non-bloquant : on ne doit pas casser le flow métier si Expo est down.
        console.warn("trySendInboxPush non bloquant:", e?.message || e);
    }
};

const createInboxNotificationForUser = async (userId, { type, message, data }) => {
    const resolvedUserId = toObjectIdString(userId);
    if (!resolvedUserId) return null;

    const user = await User.findById(resolvedUserId).select("inboxNotifications status");
    if (!user) return null;
    if (user.status && user.status !== "active") return null;

    const safeMessage = clampMessage(message, 200);
    if (!safeMessage) return null;

    user.inboxNotifications = Array.isArray(user.inboxNotifications) ? user.inboxNotifications : [];
    user.inboxNotifications.unshift({ type, message: safeMessage, data });
    await user.save();

    const created = user.inboxNotifications?.[0] || null;
    await trySendInboxPush(resolvedUserId, created);
    return created;
};

const createInboxNotificationsForUsers = async (userIds, notification) => {
    const uniqueIds = Array.from(
        new Set((Array.isArray(userIds) ? userIds : []).map(toObjectIdString).filter(Boolean)),
    );
    if (!uniqueIds.length) return [];

    const results = await Promise.all(
        uniqueIds.map((id) =>
            createInboxNotificationForUser(id, notification).catch((e) => {
                console.warn("createInboxNotificationForUser non bloquant:", e?.message || e);
                return null;
            }),
        ),
    );

    return results.filter(Boolean);
};

module.exports = {
    createInboxNotificationForUser,
    createInboxNotificationsForUsers,
};
