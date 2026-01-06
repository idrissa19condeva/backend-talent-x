const TrainingGroup = require("../models/TrainingGroup");
const TrainingSession = require("../models/TrainingSession");
const User = require("../models/User");

const OWNER_POPULATION = { path: "owner", select: "fullName username photoUrl" };
const MEMBER_POPULATION = { path: "members.user", select: "fullName username photoUrl" };
const INVITE_POPULATION = { path: "memberInvites.user", select: "fullName username photoUrl" };
const REQUEST_POPULATION = { path: "joinRequests.user", select: "fullName username photoUrl" };

const toStringId = (value) => {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    if (value._id) return value._id.toString();
    return value.toString();
};

const formatGroup = (group, currentUserId, options = {}) => {
    const { includeMembers = false, includePendingRequests = false, includeInvites = false } = options;
    const members = group.members || [];
    const ownerId = toStringId(group.owner);
    const isMember = Boolean(
        currentUserId && (ownerId === currentUserId || members.some((member) => toStringId(member.user) === currentUserId))
    );
    const pendingRequests = Array.isArray(group.joinRequests) ? group.joinRequests : [];
    const hasPendingRequest = Boolean(
        currentUserId && pendingRequests.some((request) => toStringId(request.user) === currentUserId)
    );

    const pendingInvites = Array.isArray(group.memberInvites) ? group.memberInvites : [];
    const hasPendingInvite = Boolean(
        currentUserId && pendingInvites.some((invite) => toStringId(invite.user) === currentUserId)
    );

    const mappedRequests = includePendingRequests
        ? pendingRequests.map((request) => {
            const user = request.user || {};
            if (typeof user === "string") {
                return { id: user, requestedAt: request.requestedAt };
            }
            return {
                id: user._id?.toString() || user.id || toStringId(user),
                fullName: user.fullName,
                username: user.username,
                photoUrl: user.photoUrl,
                requestedAt: request.requestedAt,
            };
        })
        : undefined;

    const mappedMembers = includeMembers
        ? members.map((member) => {
            const user = member.user || {};
            if (typeof user === "string") {
                return { id: user, joinedAt: member.joinedAt };
            }
            return {
                id: user._id?.toString() || user.id || toStringId(user),
                fullName: user.fullName,
                username: user.username,
                photoUrl: user.photoUrl,
                joinedAt: member.joinedAt,
            };
        })
        : undefined;

    const mappedInvites = includeInvites
        ? pendingInvites.map((invite) => {
            const user = invite.user || {};
            if (typeof user === "string") {
                return { id: user, invitedAt: invite.invitedAt, invitedBy: invite.invitedBy };
            }
            return {
                id: user._id?.toString() || user.id || toStringId(user),
                fullName: user.fullName,
                username: user.username,
                photoUrl: user.photoUrl,
                invitedAt: invite.invitedAt,
                invitedBy: invite.invitedBy,
            };
        })
        : undefined;

    return {
        id: group.id || group._id?.toString(),
        name: group.name,
        description: group.description,
        owner: group.owner,
        membersCount: members.length,
        isMember,
        hasPendingRequest,
        hasPendingInvite,
        pendingRequestsCount: includePendingRequests ? pendingRequests.length : undefined,
        createdAt: group.createdAt,
        members: mappedMembers,
        pendingRequests: mappedRequests,
        memberInvites: mappedInvites,
    };
};

exports.createGroup = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Le nom du groupe est requis." });
        }

        const payload = {
            name: name.trim(),
            description,
            owner: req.user.id,
            members: [{ user: req.user.id, joinedAt: new Date() }],
        };

        const group = await TrainingGroup.create(payload);
        await group.populate(OWNER_POPULATION);

        res.status(201).json(formatGroup(group, req.user.id));
    } catch (error) {
        console.error("Erreur création groupe:", error);
        if (error.code === 11000) {
            return res.status(409).json({ message: "Un groupe porte déjà ce nom." });
        }
        res.status(500).json({ message: "Impossible de créer le groupe" });
    }
};

exports.searchGroups = async (req, res) => {
    try {
        const query = req.query.q?.toString().trim();
        const limitParam = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 50);
        const filter = query ? { name: { $regex: query, $options: "i" } } : {};
        const groups = await TrainingGroup.find(filter)
            .sort({ createdAt: -1 })
            .limit(limitParam)
            .populate(OWNER_POPULATION);
        const payload = groups.map((group) => formatGroup(group, req.user.id));
        res.json(payload);
    } catch (error) {
        console.error("Erreur recherche groupes:", error);
        res.status(500).json({ message: "Impossible de rechercher des groupes" });
    }
};

exports.listMyGroups = async (req, res) => {
    try {
        const groups = await TrainingGroup.find({
            $or: [{ owner: req.user.id }, { "members.user": req.user.id }, { "memberInvites.user": req.user.id }],
        })
            .sort({ name: 1 })
            .populate(OWNER_POPULATION);
        const payload = groups.map((group) =>
            formatGroup(group, req.user.id, { includeMembers: true, includePendingRequests: true })
        );
        res.json(payload);
    } catch (error) {
        console.error("Erreur liste groupes:", error);
        res.status(500).json({ message: "Impossible de récupérer vos groupes" });
    }
};

exports.getGroup = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(INVITE_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const ownerId = toStringId(group.owner);
        const isMember = ownerId === userId || group.members?.some((member) => toStringId(member.user) === userId);

        // Allow public read: return group info but only expose member list to members/owner.
        res.json(
            formatGroup(group, userId, {
                includeMembers: isMember,
                includePendingRequests: userId === ownerId,
                includeInvites: userId === ownerId,
            }),
        );
    } catch (error) {
        console.error("Erreur récupération groupe:", error);
        res.status(500).json({ message: "Impossible de récupérer ce groupe" });
    }
};

exports.updateGroup = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Le nom du groupe est requis." });
        }

        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== userId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut le modifier" });
        }

        group.name = name.trim();
        group.description = description?.trim() ? description.trim() : undefined;

        await group.save();
        await group.populate(OWNER_POPULATION);

        res.json(formatGroup(group, userId, { includeMembers: true }));
    } catch (error) {
        console.error("Erreur mise à jour groupe:", error);
        if (error.code === 11000) {
            return res.status(409).json({ message: "Un groupe porte déjà ce nom." });
        }
        res.status(500).json({ message: "Impossible de mettre à jour ce groupe" });
    }
};

exports.deleteGroup = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id).select("owner name");
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== userId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut le supprimer" });
        }

        await TrainingSession.updateMany({ group: group._id }, { $unset: { group: 1 } });
        await TrainingGroup.deleteOne({ _id: group._id });

        return res.status(200).json({ ok: true, message: "Groupe supprimé", id: group._id.toString() });
    } catch (error) {
        console.error("Erreur suppression groupe:", error);
        return res.status(500).json({ message: "Impossible de supprimer ce groupe" });
    }
};

exports.joinGroup = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const ownerId = toStringId(group.owner);
        const alreadyMember = ownerId === userId || group.members?.some((member) => toStringId(member.user) === userId);
        if (alreadyMember) {
            return res.status(400).json({ message: "Vous faites déjà partie de ce groupe" });
        }

        // If the user has a pending invite, joining acts as accepting it.
        const inviteIndex = group.memberInvites?.findIndex((invite) => toStringId(invite.user) === userId) ?? -1;
        if (inviteIndex !== -1) {
            group.members.push({ user: userId, joinedAt: new Date() });
            group.memberInvites.splice(inviteIndex, 1);
            // Clean up possible redundant join request.
            group.joinRequests = group.joinRequests?.filter((reqItem) => toStringId(reqItem.user) !== userId) || [];
            await group.save();
            await group.populate(OWNER_POPULATION);
            return res.status(201).json({ message: "Invitation acceptée", ...formatGroup(group, userId) });
        }

        const alreadyRequested = group.joinRequests?.some((reqItem) => toStringId(reqItem.user) === userId);
        if (alreadyRequested) {
            return res.status(400).json({ message: "Demande déjà envoyée" });
        }

        group.joinRequests = group.joinRequests || [];
        group.joinRequests.push({ user: userId, requestedAt: new Date() });
        await group.save();
        await group.populate(OWNER_POPULATION);

        res.status(202).json({ message: "Demande envoyée au coach", ...formatGroup(group, userId) });
    } catch (error) {
        console.error("Erreur rejoindre groupe:", error);
        res.status(500).json({ message: "Impossible de rejoindre ce groupe" });
    }
};

exports.addMember = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || !userId.toString().trim()) {
            return res.status(400).json({ message: "Identifiant de l'athlète requis" });
        }

        const targetUserId = userId.toString().trim();
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const requesterId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut ajouter des membres" });
        }

        if (targetUserId === ownerId) {
            return res.status(400).json({ message: "Vous faites déjà partie du groupe" });
        }

        const targetUser = await User.findById(targetUserId).select("_id fullName username photoUrl");
        if (!targetUser) {
            return res.status(404).json({ message: "Athlète introuvable" });
        }

        const alreadyMember = group.members?.some((member) => toStringId(member.user) === targetUserId);
        if (alreadyMember) {
            return res.status(400).json({ message: "Cet athlète est déjà membre" });
        }

        const alreadyInvited = group.memberInvites?.some((invite) => toStringId(invite.user) === targetUserId);
        if (alreadyInvited) {
            return res.status(409).json({ message: "Invitation déjà envoyée" });
        }

        // Convert direct add into an invitation that the user must accept.
        group.memberInvites = group.memberInvites || [];
        group.memberInvites.push({ user: targetUserId, invitedAt: new Date(), invitedBy: requesterId });
        // If the user had requested to join, keep only the invitation to avoid duplicates.
        group.joinRequests = group.joinRequests?.filter((reqItem) => toStringId(reqItem.user) !== targetUserId) || [];

        await group.save();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(INVITE_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.status(202).json({
            message: "Invitation envoyée",
            ...formatGroup(group, requesterId, { includeMembers: true, includePendingRequests: true, includeInvites: true }),
        });
    } catch (error) {
        console.error("Erreur ajout membre groupe:", error);
        res.status(500).json({ message: "Impossible d'envoyer l'invitation" });
    }
};

exports.acceptMemberInvite = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(INVITE_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const ownerId = toStringId(group.owner);
        const alreadyMember = ownerId === userId || group.members?.some((member) => toStringId(member.user) === userId);
        if (alreadyMember) {
            group.memberInvites = group.memberInvites?.filter((invite) => toStringId(invite.user) !== userId) || [];
            group.joinRequests = group.joinRequests?.filter((reqItem) => toStringId(reqItem.user) !== userId) || [];
            await group.save();
            return res.json(formatGroup(group, userId, { includeMembers: true }));
        }

        const inviteIndex = group.memberInvites?.findIndex((invite) => toStringId(invite.user) === userId) ?? -1;
        if (inviteIndex === -1) {
            return res.status(404).json({ message: "Aucune invitation en attente" });
        }

        group.members.push({ user: userId, joinedAt: new Date() });
        group.memberInvites.splice(inviteIndex, 1);
        group.joinRequests = group.joinRequests?.filter((reqItem) => toStringId(reqItem.user) !== userId) || [];
        await group.save();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(INVITE_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.status(201).json({ message: "Invitation acceptée", ...formatGroup(group, userId, { includeMembers: true }) });
    } catch (error) {
        console.error("Erreur acceptation invitation groupe:", error);
        res.status(500).json({ message: "Impossible d'accepter l'invitation" });
    }
};

exports.declineMemberInvite = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(INVITE_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const userId = req.user.id;
        const inviteIndex = group.memberInvites?.findIndex((invite) => toStringId(invite.user) === userId) ?? -1;
        if (inviteIndex === -1) {
            return res.status(404).json({ message: "Aucune invitation en attente" });
        }

        group.memberInvites.splice(inviteIndex, 1);
        await group.save();
        await group.populate(OWNER_POPULATION);

        res.json({ message: "Invitation refusée", ...formatGroup(group, userId) });
    } catch (error) {
        console.error("Erreur refus invitation groupe:", error);
        res.status(500).json({ message: "Impossible de refuser l'invitation" });
    }
};

exports.cancelMemberInvite = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(INVITE_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const requesterId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut annuler une invitation" });
        }

        const targetUserId = req.params.userId?.toString().trim();
        if (!targetUserId) {
            return res.status(400).json({ message: "Athlète requis" });
        }

        const inviteIndex = group.memberInvites?.findIndex((invite) => toStringId(invite.user) === targetUserId) ?? -1;
        if (inviteIndex === -1) {
            return res.status(404).json({ message: "Invitation introuvable" });
        }

        group.memberInvites.splice(inviteIndex, 1);
        await group.save();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(INVITE_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.json({
            message: "Invitation annulée",
            ...formatGroup(group, requesterId, { includeMembers: true, includePendingRequests: true, includeInvites: true }),
        });
    } catch (error) {
        console.error("Erreur annulation invitation groupe:", error);
        res.status(500).json({ message: "Impossible d'annuler l'invitation" });
    }
};

exports.removeMember = async (req, res) => {
    try {
        const { memberId } = req.params;
        const targetMemberId = memberId?.toString().trim();
        if (!targetMemberId) {
            return res.status(400).json({ message: "Identifiant du membre requis" });
        }

        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const requesterId = req.user.id;
        const ownerId = toStringId(group.owner);
        const isSelfRemoval = requesterId === targetMemberId;
        if (!isSelfRemoval && ownerId !== requesterId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut retirer des membres" });
        }

        if (targetMemberId === ownerId) {
            return res.status(400).json({ message: "Vous ne pouvez pas vous retirer du groupe" });
        }

        const existingIndex = group.members.findIndex((member) => toStringId(member.user) === targetMemberId);
        if (existingIndex === -1) {
            return res.status(404).json({ message: "Membre introuvable" });
        }

        group.members.splice(existingIndex, 1);
        await group.save();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.json(formatGroup(group, requesterId, { includeMembers: true }));
    } catch (error) {
        console.error("Erreur suppression membre groupe:", error);
        res.status(500).json({ message: "Impossible de retirer ce membre" });
    }
};

exports.acceptJoinRequest = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const requesterId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut valider" });
        }

        const targetUserId = req.params.userId?.toString().trim();
        if (!targetUserId) {
            return res.status(400).json({ message: "Athlète requis" });
        }

        const alreadyMember = group.members?.some((member) => toStringId(member.user) === targetUserId);
        if (alreadyMember) {
            group.joinRequests = group.joinRequests?.filter((reqItem) => toStringId(reqItem.user) !== targetUserId) || [];
            await group.save();
            await group.populate(REQUEST_POPULATION);
            return res.json(
                formatGroup(group, requesterId, { includeMembers: true, includePendingRequests: true, includeInvites: true }),
            );
        }

        const pendingIndex = group.joinRequests?.findIndex((reqItem) => toStringId(reqItem.user) === targetUserId) ?? -1;
        if (pendingIndex === -1) {
            return res.status(404).json({ message: "Demande introuvable" });
        }

        group.members.push({ user: targetUserId, joinedAt: new Date() });
        group.joinRequests.splice(pendingIndex, 1);

        const notifyTarget = async () => {
            try {
                const targetUser = await User.findById(targetUserId).select("inboxNotifications fullName status");
                if (!targetUser || targetUser.status === "deleted") return;
                targetUser.inboxNotifications = targetUser.inboxNotifications || [];
                targetUser.inboxNotifications.unshift({
                    type: "group_join_accepted",
                    message: `Votre demande pour rejoindre le groupe \"${group.name}\" a été acceptée`,
                    data: { groupId: group._id?.toString?.() || req.params.id },
                });
                await targetUser.save();
            } catch (e) {
                console.warn("Notification join accepted non bloquante:", e?.message || e);
            }
        };

        await group.save();
        await notifyTarget();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(INVITE_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.json(formatGroup(group, requesterId, { includeMembers: true, includePendingRequests: true, includeInvites: true }));
    } catch (error) {
        console.error("Erreur validation demande:", error);
        res.status(500).json({ message: "Impossible de valider la demande" });
    }
};

exports.rejectJoinRequest = async (req, res) => {
    try {
        const group = await TrainingGroup.findById(req.params.id)
            .populate(OWNER_POPULATION)
            .populate(MEMBER_POPULATION)
            .populate(INVITE_POPULATION)
            .populate(REQUEST_POPULATION);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }

        const requesterId = req.user.id;
        const ownerId = toStringId(group.owner);
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut refuser" });
        }

        const targetUserId = req.params.userId?.toString().trim();
        if (!targetUserId) {
            return res.status(400).json({ message: "Athlète requis" });
        }

        const pendingIndex = group.joinRequests?.findIndex((reqItem) => toStringId(reqItem.user) === targetUserId) ?? -1;
        if (pendingIndex === -1) {
            return res.status(404).json({ message: "Demande introuvable" });
        }

        group.joinRequests.splice(pendingIndex, 1);
        await group.save();
        await group.populate(OWNER_POPULATION);
        await group.populate(MEMBER_POPULATION);
        await group.populate(INVITE_POPULATION);
        await group.populate(REQUEST_POPULATION);

        res.json(formatGroup(group, requesterId, { includeMembers: true, includePendingRequests: true, includeInvites: true }));
    } catch (error) {
        console.error("Erreur refus demande:", error);
        res.status(500).json({ message: "Impossible de refuser la demande" });
    }
};
