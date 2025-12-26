const TrainingSession = require("../models/TrainingSession");
const TrainingGroup = require("../models/TrainingGroup");
const User = require("../models/User");

const ensureValidDate = (value) => {
    const parsed = value ? new Date(value) : new Date();
    if (Number.isNaN(parsed.getTime())) {
        throw new Error("Date invalide");
    }
    return parsed;
};

const normalizeSessionTime = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : null;
};

const normalizeDurationMinutes = (value) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return Math.round(parsed);
};

const AUTO_STATUS_LOCKED = new Set(["canceled", "postponed"]);

const combineDateWithTime = (dateValue, timeValue) => {
    if (!dateValue || typeof timeValue !== "string") {
        return null;
    }
    const [hourStr, minuteStr] = timeValue.split(":");
    const hours = Number(hourStr);
    const minutes = Number(minuteStr);
    const baseDate = new Date(dateValue);
    if (Number.isNaN(baseDate.getTime()) || Number.isNaN(hours) || Number.isNaN(minutes)) {
        return null;
    }
    baseDate.setHours(hours, minutes, 0, 0);
    return baseDate;
};

const computeAutomaticStatus = (session) => {
    if (!session || AUTO_STATUS_LOCKED.has(session.status)) {
        return null;
    }
    const durationMinutes = Number(session.durationMinutes);
    if (!session.date || !session.startTime || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return null;
    }
    const startDate = combineDateWithTime(session.date, session.startTime);
    if (!startDate) {
        return null;
    }
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    const now = new Date();
    if (now < startDate) {
        return "planned";
    }
    if (now >= startDate && now < endDate) {
        return "ongoing";
    }
    return "done";
};

const ensureAutomaticStatus = async (session) => {
    if (!session) {
        return session;
    }
    const nextStatus = computeAutomaticStatus(session);
    if (!nextStatus || nextStatus === session.status) {
        return session;
    }
    await TrainingSession.updateOne({ _id: session._id }, { status: nextStatus });
    session.status = nextStatus;
    return session;
};

const ensureAutomaticStatusForMany = async (sessions = []) => {
    await Promise.all(sessions.map((session) => ensureAutomaticStatus(session)));
    return sessions;
};

const hasValidSeries = (series) => Array.isArray(series) && series.length > 0;

const sessionPopulationPaths = [
    { path: "athleteId", select: "fullName username photoUrl" },
    { path: "participants.user", select: "fullName username photoUrl" },
    { path: "participants.addedBy", select: "fullName username photoUrl" },
    { path: "group", select: "name description owner" },
];

const toStringId = (value) => {
    if (!value) return value;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value._id) return value._id.toString();
    return value.toString();
};

const findParticipant = (session, userId) =>
    session.participants?.find((participant) => toStringId(participant.user) === userId);

const GROUP_MEMBERSHIP_SELECT = "owner members.user name";

const resolveGroupAccess = async (groupId, userId) => {
    const normalizedId = toStringId(groupId);
    if (!normalizedId) {
        return { group: null, isOwner: false, isMember: false };
    }
    const group = await TrainingGroup.findById(normalizedId).select(GROUP_MEMBERSHIP_SELECT);
    if (!group) {
        return { group: null, isOwner: false, isMember: false };
    }
    const ownerId = toStringId(group.owner);
    const isOwner = ownerId === userId;
    const members = Array.isArray(group.members) ? group.members : [];
    const isMember = isOwner || members.some((member) => toStringId(member.user) === userId);
    return { group, isOwner, isMember };
};

const isUserMemberOfGroup = (group, userId) => {
    if (!group) return false;
    const ownerId = toStringId(group.owner);
    if (ownerId === userId) {
        return true;
    }
    return group.members?.some((member) => toStringId(member.user) === userId) || false;
};

const parseChronoToSeconds = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = value.toString().trim();
    if (!trimmed) {
        return null;
    }
    const normalized = trimmed.replace(",", ".");
    const colonParts = normalized.split(":").map((part) => part.trim());
    if (colonParts.length === 1) {
        const single = Number(normalized);
        return Number.isFinite(single) && single >= 0 ? single : null;
    }
    let totalSeconds = 0;
    for (let i = 0; i < colonParts.length; i += 1) {
        const part = Number(colonParts[colonParts.length - 1 - i]);
        if (!Number.isFinite(part) || part < 0) {
            return null;
        }
        if (i === 0) {
            totalSeconds += part;
        } else if (i === 1) {
            totalSeconds += part * 60;
        } else if (i === 2) {
            totalSeconds += part * 3600;
        }
    }
    return totalSeconds;
};

exports.createSession = async (req, res) => {
    try {
        const {
            type,
            title,
            place,
            description,
            series,
            status,
            coachNotes,
            athleteFeedback,
            targetIntensity,
            seriesRestInterval,
            seriesRestUnit,
            equipment,
            groupId,
            startTime,
            durationMinutes,
        } = req.body;

        const normalizedStartTime = normalizeSessionTime(startTime);
        const normalizedDuration = normalizeDurationMinutes(durationMinutes);

        if (!type || !title || !hasValidSeries(series) || !normalizedStartTime || !normalizedDuration) {
            return res.status(400).json({ message: "Type, titre, horaires et séries sont requis." });
        }

        let groupForSession = null;

        if (groupId) {
            const { group, isOwner } = await resolveGroupAccess(groupId, req.user.id);
            if (!group) {
                return res.status(404).json({ message: "Groupe introuvable" });
            }
            if (!isOwner) {
                return res.status(403).json({ message: "Seul le créateur du groupe peut publier une séance" });
            }
            groupForSession = group;
        }

        const payload = {
            athleteId: req.user.id,
            date: ensureValidDate(req.body.date),
            type,
            title,
            place,
            description,
            series,
            seriesRestInterval,
            seriesRestUnit,
            status: status || "planned",
            coachNotes,
            athleteFeedback,
            targetIntensity,
            equipment,
            startTime: normalizedStartTime,
            durationMinutes: normalizedDuration,
        };

        if (groupForSession) {
            payload.group = groupForSession._id;
        }

        const session = await TrainingSession.create(payload);
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);
        res.status(201).json(session);
    } catch (error) {
        console.error("Erreur création séance:", error);
        const message = error.message?.includes("Date invalide") ? error.message : "Erreur lors de la création de la séance";
        res.status(500).json({ message });
    }
};

exports.getSessionById = async (req, res) => {
    try {
        const session = await TrainingSession.findById(req.params.id).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }
        const userId = req.user.id;
        const isOwner = toStringId(session.athleteId) === userId;
        const isParticipant = Boolean(findParticipant(session, userId));
        let canAccess = isOwner || isParticipant;

        if (session.group) {
            const groupId = toStringId(session.group);
            const { group, isMember } = await resolveGroupAccess(groupId, userId);
            if (!group) {
                return res.status(404).json({ message: "Le groupe lié à cette séance est introuvable" });
            }
            canAccess = canAccess || isMember;
        }

        if (!canAccess) {
            return res.status(403).json({ message: "Vous n'avez pas accès à cette séance" });
        }

        await ensureAutomaticStatus(session);
        res.json(session);
    } catch (error) {
        console.error("Erreur récupération séance:", error);
        res.status(500).json({ message: "Erreur lors de la récupération de la séance" });
    }
};

exports.listSessions = async (req, res) => {
    try {
        const sessions = await TrainingSession.find({ athleteId: req.user.id })
            .sort({ date: -1, createdAt: -1 })
            .populate(sessionPopulationPaths);
        await ensureAutomaticStatusForMany(sessions);
        res.json(sessions);
    } catch (error) {
        console.error("Erreur liste séances:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des séances" });
    }
};

exports.listGroupSessions = async (req, res) => {
    try {
        const { group, isMember } = await resolveGroupAccess(req.params.id, req.user.id);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }
        if (!isMember) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce groupe" });
        }

        const sessions = await TrainingSession.find({ group: group._id })
            .sort({ date: -1, createdAt: -1 })
            .populate(sessionPopulationPaths);
        await ensureAutomaticStatusForMany(sessions);
        res.json(sessions);
    } catch (error) {
        console.error("Erreur liste séances groupe:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des séances du groupe" });
    }
};

exports.attachSessionToGroup = async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId || !sessionId.toString().trim()) {
            return res.status(400).json({ message: "Identifiant de la séance requis" });
        }

        const { group, isOwner } = await resolveGroupAccess(req.params.id, req.user.id);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }
        if (!isOwner) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut ajouter une séance" });
        }

        const session = await TrainingSession.findById(sessionId).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        if (toStringId(session.athleteId) !== req.user.id) {
            return res.status(403).json({ message: "Vous ne pouvez partager que vos propres séances" });
        }

        if (session.group && toStringId(session.group) !== req.params.id) {
            return res.status(400).json({ message: "Cette séance est déjà partagée dans un autre groupe" });
        }

        session.group = group._id;
        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur attachement séance groupe:", error);
        res.status(500).json({ message: "Impossible d'ajouter cette séance au groupe" });
    }
};

exports.detachSessionFromGroup = async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            return res.status(400).json({ message: "Identifiant de la séance requis" });
        }

        const { group, isOwner } = await resolveGroupAccess(req.params.id, req.user.id);
        if (!group) {
            return res.status(404).json({ message: "Groupe introuvable" });
        }
        if (!isOwner) {
            return res.status(403).json({ message: "Seul le créateur du groupe peut retirer une séance" });
        }

        const session = await TrainingSession.findById(sessionId).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        if (toStringId(session.athleteId) !== req.user.id) {
            return res.status(403).json({ message: "Vous ne pouvez retirer que vos propres séances" });
        }

        if (!session.group || toStringId(session.group) !== req.params.id) {
            return res.status(400).json({ message: "Cette séance n'est pas partagée dans ce groupe" });
        }

        session.group = undefined;
        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur retrait séance groupe:", error);
        res.status(500).json({ message: "Impossible de retirer cette séance" });
    }
};

exports.saveChronos = async (req, res) => {
    try {
        const session = await TrainingSession.findById(req.params.id).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        const ownerId = toStringId(session.athleteId);
        if (ownerId !== req.user.id) {
            return res.status(403).json({ message: "Seul le créateur de la séance peut enregistrer les chronos" });
        }

        const allowedParticipants = new Set();
        if (ownerId) {
            allowedParticipants.add(ownerId);
        }
        (session.participants || []).forEach((participant) => {
            const participantId = toStringId(participant.user);
            if (participantId) {
                allowedParticipants.add(participantId);
            }
        });

        const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
        const normalizedChronos = entries
            .map((entry) => {
                const participantId = toStringId(entry.participantId || entry.participant);
                const seriesId = entry.seriesId ? entry.seriesId.toString() : null;
                const segmentId = entry.segmentId ? entry.segmentId.toString() : null;
                const time = typeof entry.time === "string" ? entry.time.trim() : "";

                if (!participantId || !allowedParticipants.has(participantId)) {
                    return null;
                }
                if (!seriesId || !segmentId || !time) {
                    return null;
                }

                const distanceValue = Number(entry.distance);
                const secondsValue = parseChronoToSeconds(time);
                const parsedSeriesIndex = Number(entry.seriesIndex);
                const parsedRepeatIndex = Number(entry.repeatIndex);
                const parsedSegmentIndex = Number(entry.segmentIndex);
                const parsedRepetitionIndex = Number(entry.repetitionIndex);

                return {
                    participant: participantId,
                    seriesId,
                    seriesIndex: Number.isFinite(parsedSeriesIndex) ? parsedSeriesIndex : 0,
                    repeatIndex: Number.isFinite(parsedRepeatIndex) ? parsedRepeatIndex : 0,
                    segmentId,
                    segmentIndex: Number.isFinite(parsedSegmentIndex) ? parsedSegmentIndex : 0,
                    repetitionIndex: Number.isFinite(parsedRepetitionIndex) ? parsedRepetitionIndex : 0,
                    distance: Number.isFinite(distanceValue) && distanceValue >= 0 ? distanceValue : undefined,
                    time,
                    seconds: secondsValue !== null ? secondsValue : undefined,
                    updatedAt: new Date(),
                    updatedBy: req.user.id,
                };
            })
            .filter(Boolean);

        session.chronos = normalizedChronos;
        session.markModified("chronos");
        await ensureAutomaticStatus(session);
        await session.save();
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur enregistrement chronos séance:", error);
        res.status(500).json({ message: "Impossible d'enregistrer les chronos" });
    }
};

exports.listParticipantSessions = async (req, res) => {
    try {
        const sessions = await TrainingSession.find({ "participants.user": req.user.id })
            .sort({ date: -1, createdAt: -1 })
            .populate(sessionPopulationPaths);
        await ensureAutomaticStatusForMany(sessions);
        res.json(sessions);
    } catch (error) {
        console.error("Erreur liste participations:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des séances auxquelles vous participez" });
    }
};

exports.updateSession = async (req, res) => {
    try {
        const session = await TrainingSession.findOne({ _id: req.params.id, athleteId: req.user.id });
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        const {
            type,
            title,
            place,
            description,
            series,
            status,
            coachNotes,
            athleteFeedback,
            targetIntensity,
            seriesRestInterval,
            seriesRestUnit,
            equipment,
            groupId,
            startTime,
            durationMinutes,
        } = req.body;

        const normalizedStartTime = normalizeSessionTime(startTime);
        const normalizedDuration = normalizeDurationMinutes(durationMinutes);

        if (!type || !title || !hasValidSeries(series) || !normalizedStartTime || !normalizedDuration) {
            return res.status(400).json({ message: "Type, titre, horaires et séries sont requis." });
        }

        let nextGroupId = session.group ? toStringId(session.group) : null;
        if (typeof groupId !== "undefined") {
            if (!groupId) {
                nextGroupId = null;
            } else {
                const { group, isOwner } = await resolveGroupAccess(groupId, req.user.id);
                if (!group) {
                    return res.status(404).json({ message: "Groupe introuvable" });
                }
                if (!isOwner) {
                    return res.status(403).json({ message: "Seul le créateur du groupe peut publier une séance" });
                }
                nextGroupId = group._id.toString();
            }
        }

        session.date = req.body.date ? ensureValidDate(req.body.date) : session.date;
        session.type = type;
        session.title = title;
        session.place = place;
        session.description = typeof description === "string" ? description : session.description;
        session.startTime = normalizedStartTime;
        session.durationMinutes = normalizedDuration;
        session.series = series;
        session.seriesRestInterval = seriesRestInterval;
        session.seriesRestUnit = seriesRestUnit;
        session.status = status || session.status;
        session.coachNotes = coachNotes;
        session.athleteFeedback = athleteFeedback;
        session.targetIntensity = targetIntensity;
        session.equipment = equipment;
        session.group = nextGroupId || undefined;

        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);
        res.json(session);
    } catch (error) {
        console.error("Erreur mise à jour séance:", error);
        const message = error.message?.includes("Date invalide")
            ? error.message
            : "Erreur lors de la mise à jour de la séance";
        res.status(500).json({ message });
    }
};

exports.deleteSession = async (req, res) => {
    try {
        const session = await TrainingSession.findOne({ _id: req.params.id, athleteId: req.user.id });
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }
        await TrainingSession.deleteOne({ _id: session._id });
        res.status(204).send();
    } catch (error) {
        console.error("Erreur suppression séance:", error);
        res.status(500).json({ message: "Erreur lors de la suppression de la séance" });
    }
};

exports.joinSession = async (req, res) => {
    try {
        const session = await TrainingSession.findById(req.params.id).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        if (toStringId(session.athleteId) === req.user.id) {
            return res.status(400).json({ message: "Vous êtes déjà l'athlète principal de cette séance." });
        }

        if (session.group) {
            const groupId = toStringId(session.group);
            const { group, isMember } = await resolveGroupAccess(groupId, req.user.id);
            if (!group) {
                return res.status(404).json({ message: "Le groupe lié à cette séance est introuvable" });
            }
            if (!isMember) {
                return res.status(403).json({ message: "Seuls les membres du groupe peuvent participer à cette séance" });
            }
        }

        const existingParticipant = findParticipant(session, req.user.id);
        if (existingParticipant) {
            const status = existingParticipant.status || "confirmed";
            if (status === "confirmed") {
                return res.status(400).json({ message: "Vous êtes déjà inscrit à cette séance." });
            }
            existingParticipant.status = "confirmed";
            existingParticipant.addedBy = existingParticipant.addedBy || req.user.id;
            existingParticipant.addedAt = existingParticipant.addedAt || new Date();
            existingParticipant.confirmedAt = new Date();
        } else {
            session.participants.push({
                user: req.user.id,
                addedBy: req.user.id,
                addedAt: new Date(),
                confirmedAt: new Date(),
                status: "confirmed",
            });
        }
        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur inscription séance:", error);
        res.status(500).json({ message: "Impossible de s'inscrire à la séance" });
    }
};

exports.leaveSession = async (req, res) => {
    try {
        const session = await TrainingSession.findById(req.params.id).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        if (toStringId(session.athleteId) === req.user.id) {
            return res.status(400).json({ message: "Vous êtes le créateur de cette séance." });
        }

        const participants = Array.isArray(session.participants) ? session.participants : [];
        const participantIndex = participants.findIndex((participant) => toStringId(participant.user) === req.user.id);

        if (participantIndex === -1) {
            return res.status(400).json({ message: "Vous n'êtes pas inscrit à cette séance." });
        }

        participants.splice(participantIndex, 1);
        session.participants = participants;

        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur désinscription séance:", error);
        res.status(500).json({ message: "Impossible de se désinscrire de la séance" });
    }
};

exports.addParticipantToSession = async (req, res) => {
    try {
        const { userId: targetUserId } = req.body;
        if (!targetUserId) {
            return res.status(400).json({ message: "L'identifiant de l'utilisateur est requis." });
        }

        const session = await TrainingSession.findOne({ _id: req.params.id, athleteId: req.user.id });
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        if (toStringId(session.athleteId) === targetUserId) {
            return res.status(400).json({ message: "L'athlète principal est déjà rattaché à cette séance." });
        }

        if (findParticipant(session, targetUserId)) {
            return res.status(400).json({ message: "Cet utilisateur est déjà inscrit à la séance." });
        }

        let sessionGroup = null;
        if (session.group) {
            const groupId = toStringId(session.group);
            const { group } = await resolveGroupAccess(groupId, req.user.id);
            if (!group) {
                return res.status(404).json({ message: "Le groupe lié à cette séance est introuvable" });
            }
            sessionGroup = group;
        }

        const targetUser = await User.findById(targetUserId).select("_id");
        if (!targetUser) {
            return res.status(404).json({ message: "Utilisateur introuvable" });
        }

        if (sessionGroup && !isUserMemberOfGroup(sessionGroup, targetUserId)) {
            return res.status(400).json({ message: "Cet utilisateur ne fait pas partie de ce groupe" });
        }

        session.participants.push({
            user: targetUserId,
            addedBy: req.user.id,
            addedAt: new Date(),
            status: "pending",
        });
        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur ajout participant séance:", error);
        res.status(500).json({ message: "Impossible d'ajouter cet utilisateur à la séance" });
    }
};

exports.removeParticipantFromSession = async (req, res) => {
    try {
        const { participantId } = req.params;
        if (!participantId) {
            return res.status(400).json({ message: "L'identifiant du participant est requis." });
        }

        const session = await TrainingSession.findOne({ _id: req.params.id, athleteId: req.user.id }).populate(sessionPopulationPaths);
        if (!session) {
            return res.status(404).json({ message: "Séance introuvable" });
        }

        const participants = Array.isArray(session.participants) ? session.participants : [];
        const indexToRemove = participants.findIndex((participant) => toStringId(participant.user) === participantId);

        if (indexToRemove === -1) {
            return res.status(404).json({ message: "Participant introuvable" });
        }

        participants.splice(indexToRemove, 1);
        session.participants = participants;

        await session.save();
        await ensureAutomaticStatus(session);
        await session.populate(sessionPopulationPaths);

        res.json(session);
    } catch (error) {
        console.error("Erreur suppression participant séance:", error);
        res.status(500).json({ message: "Impossible de retirer ce participant" });
    }
};
