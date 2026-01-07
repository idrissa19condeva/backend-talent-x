const bcrypt = require("bcryptjs");
const User = require("../models/User");
const TrainingGroup = require("../models/TrainingGroup");
const TrainingTemplate = require("../models/TrainingTemplate");
const TrainingBlock = require("../models/TrainingBlock");
const TrainingSession = require("../models/TrainingSession");
const fetch = require("node-fetch");
const { buildPerformancePoints } = require("../services/ffaService");
const sharp = require("sharp");

const sanitizeMapMerge = (source, incoming) => {
    if (!incoming || typeof incoming !== "object") return source;
    const base = source?.toObject ? source.toObject() : source || {};
    return Object.entries(incoming).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
            acc[key] = value;
        }
        return acc;
    }, { ...base });
};

const normalizeDiscipline = (value) => (value || "").trim().toLowerCase();
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectIdString = (value) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object" && typeof value.toString === "function") {
        return value.toString();
    }
    return String(value);
};

const hasObjectId = (collection = [], target) => {
    const needle = toObjectIdString(target);
    if (!needle) return false;
    return collection.some((entry) => toObjectIdString(entry) === needle);
};

const pullObjectId = (collection = [], target) => {
    const needle = toObjectIdString(target);
    if (!needle) return collection || [];
    return (collection || []).filter((entry) => toObjectIdString(entry) !== needle);
};

const pushUniqueObjectId = (collection = [], target) => {
    if (!target) return collection || [];
    const list = collection || [];
    if (!hasObjectId(list, target)) {
        list.push(target);
    }
    return list;
};

const monthMap = {
    janvier: 0, janv: 0,
    fevrier: 1, février: 1, fev: 1, fév: 1,
    mars: 2,
    avril: 3, avr: 3,
    mai: 4,
    juin: 5,
    juillet: 6, juil: 6,
    aout: 7, août: 7,
    septembre: 8, sept: 8,
    octobre: 9, oct: 9,
    novembre: 10, nov: 10,
    decembre: 11, décembre: 11, dec: 11, déc: 11,
};

const parseFrenchDate = (value, yearHint) => {
    if (!value) return null;
    const raw = value.trim().replace(/\./g, "").toLowerCase();

    // Format "12 mars" / "12 fev"
    const matchMonth = raw.match(/^(\d{1,2})\s+([a-zéûô]+)/i);
    if (matchMonth) {
        const day = Number(matchMonth[1]);
        const month = monthMap[matchMonth[2]];
        if (month !== undefined && !Number.isNaN(day)) {
            const year = Number(yearHint) || new Date().getFullYear();
            const d = new Date(year, month, day);
            if (!Number.isNaN(d.getTime())) return d;
        }
    }

    // Format "dd/mm/yyyy" ou "dd/mm/yy"
    const matchSlash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (matchSlash) {
        const day = Number(matchSlash[1]);
        const month = Number(matchSlash[2]) - 1;
        const yearNum = Number(matchSlash[3]);
        const year = yearNum < 100 ? 2000 + yearNum : yearNum;
        const d = new Date(year, month, day);
        if (!Number.isNaN(d.getTime())) return d;
    }

    // Fallback: ISO ou Date parsable directement
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;

    return null;
};

const parsePerformanceToNumber = (value) => {
    if (!value) return null;
    const str = String(value)
        .trim()
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/\u2032/g, "'")
        .replace(/\u2033/g, '"');

    // Temps au format 42'59'' (41'16'') -> on extrait un mm'ss'' (priorité au premier dans des parenthèses, sinon le premier trouvé)
    const extractApostropheTime = (s) => {
        // Cherche d'abord dans des parenthèses
        const paren = s.match(/\(([^)]*)\)/);
        const scope = paren ? paren[1] : s;

        // mm'ss''cc or mm'ss"cc
        const mmsscc = scope.match(/(\d{1,2})\s*['’′]\s*(\d{1,2})(?:\s*(?:['’′]{2}|["″])\s*(\d{1,2}))?/);
        if (mmsscc) {
            const m = Number(mmsscc[1]);
            const sec = Number(mmsscc[2]);
            const centisRaw = mmsscc[3];
            const centis = centisRaw ? Number(centisRaw) : 0;
            if (!Number.isFinite(m) || !Number.isFinite(sec) || !Number.isFinite(centis)) return null;
            const centisFactor = centisRaw && String(centisRaw).length === 1 ? 10 : 100;
            return m * 60 + sec + centis / centisFactor;
        }

        // ss''cc (sprints)
        const sscc = scope.match(/\b(\d{1,3})\s*(?:['’′]{2}|["″])\s*(\d{1,2})\b/);
        if (sscc) {
            const sec = Number(sscc[1]);
            const centisRaw = sscc[2];
            const centis = centisRaw ? Number(centisRaw) : 0;
            if (!Number.isFinite(sec) || !Number.isFinite(centis)) return null;
            const centisFactor = centisRaw && String(centisRaw).length === 1 ? 10 : 100;
            return sec + centis / centisFactor;
        }

        return null;
    };

    const apostropheTime = extractApostropheTime(str);
    if (apostropheTime !== null) return apostropheTime;

    if (str.includes(":")) {
        const [m, s] = str.split(":");
        const minutes = Number(m);
        const seconds = Number(s?.replace(/[^0-9.,-]/g, "").replace(/,/g, "."));
        if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes * 60 + seconds;
    }
    const normalized = str.replace(/''/g, ".").replace(/’/g, "'").replace(/[^0-9.,-]/g, "").replace(/,/g, ".");
    if (normalized.trim() === "") return null; // avoid treating non-numeric labels (DNF, DSQ, etc.) as 0
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

// Extracts wind/anemometer value as a finite number
const parseWindToNumber = (value) => {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const buildFfaTimelines = (ffaMergedByEvent = {}) => {
    const timelines = {};
    for (const [epreuve, entries] of Object.entries(ffaMergedByEvent || {})) {
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const mapped = entries
            .map((entry) => {
                const dateObj = parseFrenchDate(entry.date, entry.year);
                const timestamp = dateObj ? dateObj.getTime() : null;
                const value = parsePerformanceToNumber(entry.performance);
                const wind =
                    parseWindToNumber(entry.anemometre) ??
                    parseWindToNumber(entry.anemo) ??
                    parseWindToNumber(entry.vent) ??
                    parseWindToNumber(entry.wind);
                // Always keep entry if a label exists (DNF, DSQ, etc.)
                if ((value === null || value === undefined) && (!entry?.performance || String(entry.performance).trim() === "")) return null;
                if (timestamp === null) return null;
                const safeValue = Number.isFinite(value) ? value : entry.performance;
                return {
                    date: new Date(timestamp).toISOString(),
                    rawDate: entry.date,
                    year: entry.year ? Number(entry.year) || undefined : undefined,
                    value: safeValue,
                    rawPerformance: entry.performance || undefined,
                    wind,
                    discipline: epreuve,
                    meeting: entry.lieu,
                    city: entry.lieu,
                    surface: entry.niveau,
                    notes: entry.tour,
                    place: entry.place,
                    points: entry.points ? Number(entry.points) || undefined : undefined,
                    timestamp,
                };
            })
            .filter(Boolean)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (mapped.length > 0) {
            timelines[epreuve] = mapped.map(({ timestamp, ...rest }) => rest);
        }
    }
    return timelines;
};

const buildRelationshipPayload = (userDoc, viewerId) => {
    const viewer = toObjectIdString(viewerId);
    const userId = toObjectIdString(userDoc?._id);
    const isSelf = Boolean(viewer && userId && viewer === userId);
    const friends = userDoc?.friends || [];
    const outgoingList = userDoc?.friendRequestsReceived || [];
    const incomingList = userDoc?.friendRequestsSent || [];
    const friendsCount = Array.isArray(friends) ? friends.length : 0;

    const areFriends = viewer ? hasObjectId(friends, viewer) : false;
    const outgoingRequest = viewer ? hasObjectId(outgoingList, viewer) : false; // viewer a déjà envoyé
    const incomingRequest = viewer ? hasObjectId(incomingList, viewer) : false; // viewer a reçu

    let status = "none";
    if (isSelf) {
        status = "self";
    } else if (areFriends) {
        status = "friends";
    } else if (outgoingRequest) {
        status = "outgoing";
    } else if (incomingRequest) {
        status = "incoming";
    }

    return {
        status,
        isSelf,
        areFriends,
        outgoingRequest,
        incomingRequest,
        friendsCount,
    };
};

// 🔹 DELETE /api/user/delete
exports.deleteAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non authentifié" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        // 1) Delete everything the user owns
        await Promise.all([
            TrainingGroup.deleteMany({ owner: userId }),
            TrainingTemplate.deleteMany({ ownerId: userId }),
            TrainingBlock.deleteMany({ ownerId: userId }),
            TrainingSession.deleteMany({ athleteId: userId }),
        ]);

        // 2) Remove references in other collections
        await Promise.all([
            // Groups: membership/invites/requests
            TrainingGroup.updateMany(
                { "members.user": userId },
                { $pull: { members: { user: userId } } }
            ),
            TrainingGroup.updateMany(
                { "memberInvites.user": userId },
                { $pull: { memberInvites: { user: userId } } }
            ),
            TrainingGroup.updateMany(
                { "memberInvites.invitedBy": userId },
                { $pull: { memberInvites: { invitedBy: userId } } }
            ),
            TrainingGroup.updateMany(
                { "joinRequests.user": userId },
                { $pull: { joinRequests: { user: userId } } }
            ),

            // Sessions: remove participations and chronos linked to this user
            TrainingSession.updateMany(
                { "participants.user": userId },
                { $pull: { participants: { user: userId } } }
            ),
            TrainingSession.updateMany(
                { "participants.addedBy": userId },
                { $pull: { participants: { addedBy: userId } } }
            ),
            TrainingSession.updateMany(
                { "chronos.participant": userId },
                { $pull: { chronos: { participant: userId } } }
            ),
            TrainingSession.updateMany(
                { "chronos.updatedBy": userId },
                { $unset: { "chronos.$[c].updatedBy": "" } },
                { arrayFilters: [{ "c.updatedBy": userId }] }
            ),

            // Users: remove friendships/requests referencing this user
            User.updateMany({ friends: userId }, { $pull: { friends: userId } }),
            User.updateMany({ friendRequestsSent: userId }, { $pull: { friendRequestsSent: userId } }),
            User.updateMany({ friendRequestsReceived: userId }, { $pull: { friendRequestsReceived: userId } }),
        ]);

        // 3) Finally remove the user document
        await User.deleteOne({ _id: userId });

        return res.json({ message: "Compte supprimé" });
    } catch (error) {
        console.error("Erreur deleteAccount:", error);
        return res.status(500).json({ message: "Impossible de supprimer le compte maintenant" });
    }
};

// 🔹 GET /api/user/me
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-passwordHash -rpmUserToken");
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

        const payload = user.toObject({ flattenMaps: true });
        payload.records = payload.records || {};
        payload.recordPoints = payload.recordPoints || {};
        payload.seasonPerformances = payload.seasonPerformances || {};
        payload.performances = payload.performances || [];
        payload.performanceTimeline = payload.performanceTimeline || [];
        if (payload.performanceTimeline.length === 0 && payload.ffaResultsByYear) {
            // Build frontend-ready timeline from stored FFA results
            payload.performanceTimeline = buildPerformancePoints(payload.ffaResultsByYear);
        }
        payload.relationship = buildRelationshipPayload(user, req.user.id);

        res.json(payload);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

// 🔹 PUT /api/user/update
exports.updateProfile = async (req, res) => {
    try {
        const allowedFields = [
            "username", "gender", "birthDate", "country", "city", "language", "photoUrl",
            "phone", "phoneNumber", "trainingAddress", "licenseNumber",
            "mainDiscipline", "otherDisciplines", "club", "level", "goals",
            "dominantLeg", "favoriteCoach", "isProfilePublic", "notificationsEnabled", "autoSharePerformance",
            "theme", "instagram", "strava", "tiktok", "website", "category", "performances",
            "rpmAvatarUrl", "rpmAvatarPreviewUrl", "rpmAvatarMeta", "records", "recordPoints", "seasonPerformances",
            "xp", "levelName", "medals", "followers", "following", "achievements", "favoriteSurface",
            "preferredTrainingTime", "weeklySessions", "totalDistance", "bestPerformance", "lastActivityDate", "streakDays",
            "bio", "friends", "badges", "competitionsCount", "challengesCount", "rankGlobal",
            "rankNational", "trackPoints", "bodyWeightKg", "maxMuscuKg", "maxChariotKg"
        ];

        const numericFields = new Set([
            "bodyWeightKg",
            "maxMuscuKg",
            "maxChariotKg",
            "xp",
            "totalDistance",
            "trackPoints",
            "rankGlobal",
            "rankNational",
            "competitionsCount",
            "challengesCount",
            "followers",
            "following",
            "streakDays",
            "weeklySessions",
        ]);

        const mergeableMaps = new Set(["records", "recordPoints", "seasonPerformances"]);
        const dateFields = new Set(["birthDate"]);

        const user = await User.findById(req.user.id).select("-passwordHash -rpmUserToken");
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        allowedFields.forEach((field) => {
            if (req.body[field] === undefined) {
                return;
            }

            if (mergeableMaps.has(field)) {
                const payload = req.body[field];
                if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                    user[field] = sanitizeMapMerge(user[field], payload);
                }
                return;
            }

            if (numericFields.has(field)) {
                const parsed = Number(req.body[field]);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    user[field] = parsed;
                }
                return;
            }

            if (dateFields.has(field)) {
                const parsedDate = new Date(req.body[field]);
                if (!Number.isNaN(parsedDate.getTime())) {
                    user[field] = parsedDate;
                }
                return;
            }

            user[field] = req.body[field];
        });

        await user.save();
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la mise à jour", error });
    }
};

exports.uploadPhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

        // Resize + compress + normalize format (JPEG)
        // - guarantees image format
        // - reduces payload size
        // - provides stable rendering across platforms
        const resized = await sharp(req.file.buffer)
            .rotate()
            .resize(512, 512, { fit: "cover" })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();

        user.photoData = resized;
        user.photoContentType = "image/jpeg";
        user.photoVersion = (user.photoVersion || 0) + 1;
        user.photoUrl = `/api/user/photo/${user._id}?v=${user.photoVersion}`;
        await user.save();

        res.json({ message: "Photo mise à jour", photoUrl: user.photoUrl });
    } catch (error) {
        console.error("Erreur uploadPhoto:", error);
        if (error?.message?.includes("Format de fichier")) {
            return res.status(400).json({ message: error.message });
        }
        if (error?.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ message: "Image trop volumineuse (max 6MB)" });
        }
        res.status(500).json({ message: "Erreur lors de l’upload", error });
    }
};

const isExpoPushToken = (token) => {
    if (typeof token !== "string") return false;
    const trimmed = token.trim();
    return trimmed.startsWith("ExponentPushToken[") || trimmed.startsWith("ExpoPushToken[");
};

const chunkArray = (items = [], size = 100) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const sendExpoPush = async ({ tokens, title, body, data }) => {
    const messages = (tokens || [])
        .filter(isExpoPushToken)
        .map((token) => ({
            to: token,
            sound: "default",
            title: title || "Talent-X",
            body: body || "",
            data: data || {},
        }));

    if (!messages.length) {
        return { ok: true, tickets: [], message: "No valid Expo push tokens" };
    }

    const tickets = [];
    const chunks = chunkArray(messages, 100);

    for (const chunk of chunks) {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(chunk),
        });

        const json = await response.json().catch(() => null);
        if (!response.ok) {
            const message = json?.errors?.[0]?.message || json?.message || `Expo push error (${response.status})`;
            throw new Error(message);
        }

        const chunkTickets = json?.data;
        if (Array.isArray(chunkTickets)) {
            tickets.push(...chunkTickets);
        }
    }

    return { ok: true, tickets };
};

// 🔹 POST /api/user/me/push-token
exports.registerPushToken = async (req, res) => {
    try {
        const rawToken = req.body?.token;
        const token = typeof rawToken === "string" ? rawToken.trim() : "";

        if (!isExpoPushToken(token)) {
            return res.status(400).json({ message: "Token push Expo invalide" });
        }

        const user = await User.findById(req.user.id).select("expoPushTokens status");
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
        if (user.status && user.status !== "active") {
            return res.status(403).json({ message: "Compte inactif" });
        }

        user.expoPushTokens = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
        if (!user.expoPushTokens.includes(token)) {
            user.expoPushTokens.push(token);
            // Keep list reasonably small.
            if (user.expoPushTokens.length > 20) {
                user.expoPushTokens = user.expoPushTokens.slice(-20);
            }
            await user.save();
        }

        return res.json({ ok: true });
    } catch (error) {
        console.error("registerPushToken", error);
        return res.status(500).json({ message: "Erreur serveur", error });
    }
};

// 🔹 DELETE /api/user/me/push-token
exports.unregisterPushToken = async (req, res) => {
    try {
        const rawToken = req.body?.token;
        const token = typeof rawToken === "string" ? rawToken.trim() : "";
        if (!token) {
            return res.status(400).json({ message: "Token requis" });
        }

        const user = await User.findById(req.user.id).select("expoPushTokens status");
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
        if (user.status && user.status !== "active") {
            return res.status(403).json({ message: "Compte inactif" });
        }

        const before = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
        user.expoPushTokens = before.filter((t) => t !== token);
        await user.save();

        return res.json({ ok: true });
    } catch (error) {
        console.error("unregisterPushToken", error);
        return res.status(500).json({ message: "Erreur serveur", error });
    }
};

// 🔹 POST /api/user/me/push-test
exports.sendMyTestPush = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("expoPushTokens notificationsEnabled status");
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
        if (user.status && user.status !== "active") {
            return res.status(403).json({ message: "Compte inactif" });
        }
        if (!user.notificationsEnabled) {
            return res.status(400).json({ message: "Notifications désactivées" });
        }

        const tokens = Array.isArray(user.expoPushTokens) ? user.expoPushTokens : [];
        if (!tokens.length) {
            return res.status(400).json({ message: "Aucun appareil enregistré" });
        }

        const title = typeof req.body?.title === "string" ? req.body.title : "Talent-X";
        const body = typeof req.body?.body === "string" ? req.body.body : "Notification de test";

        const result = await sendExpoPush({
            tokens,
            title,
            body,
            data: { kind: "test" },
        });

        return res.json({ ok: true, result });
    } catch (error) {
        console.error("sendMyTestPush", error);
        return res.status(500).json({ message: "Erreur serveur", error: { message: error?.message } });
    }
};

exports.getPhoto = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id).select("photoData photoContentType");
        if (!user || !user.photoData) {
            return res.status(404).json({ message: "Photo non trouvée" });
        }

        res.set("Content-Type", user.photoContentType || "application/octet-stream");
        res.set("Cache-Control", "no-store");
        return res.send(user.photoData);
    } catch (error) {
        console.error("Erreur lors de la récupération de la photo:", error);
        return res.status(500).json({ message: "Erreur lors de la récupération de la photo" });
    }
};
/**
 * ✏️ PUT /api/users/:id/performances
 * Met à jour ou ajoute une performance pour une épreuve donnée
 */
exports.updatePerformances = async (req, res) => {
    try {
        const { id } = req.params;
        const { epreuve, record, bestSeason } = req.body;

        if (!epreuve) {
            return res.status(400).json({ message: "L'épreuve est requise." });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        // Cherche si l'épreuve existe déjà
        const existing = user.performances.find(
            (p) => p.epreuve.toLowerCase() === epreuve.toLowerCase()
        );

        if (existing) {
            // 🔄 Met à jour les valeurs existantes
            if (record) existing.record = record;
            if (bestSeason) existing.bestSeason = bestSeason;
        } else {
            // ➕ Ajoute une nouvelle épreuve
            user.performances.push({ epreuve, record, bestSeason });
        }

        await user.save();

        res.status(200).json({
            message: "Performance mise à jour avec succès.",
            performances: user.performances,
        });
    } catch (error) {
        console.error("Erreur mise à jour performance:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

exports.getPerformanceTimeline = async (req, res) => {
    try {
        const { discipline } = req.query;
        const user = await User.findById(req.user.id).select("performanceTimeline ffaMergedByEvent ffaResultsByYear");
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const normalized = discipline ? normalizeDiscipline(discipline) : null;
        const timeline = (user.performanceTimeline || [])
            .filter((point) => {
                if (!normalized) return true;
                return normalizeDiscipline(point.discipline) === normalized;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // fallback vers ffaResultsByYear (base brute) puis ffaMergedByEvent si aucune timeline n'est présente
        if (timeline.length === 0) {
            if (user.ffaResultsByYear) {
                const built = buildPerformancePoints(user.ffaResultsByYear);
                const filtered = normalized
                    ? built.filter((p) => normalizeDiscipline(p.discipline) === normalized)
                    : built;
                if (filtered.length > 0) {
                    return res.json(filtered);
                }
            }

            if (user.ffaMergedByEvent) {
                const timelines = buildFfaTimelines(user.ffaMergedByEvent);
                const fallback = normalized ? timelines[discipline] || [] : Object.values(timelines).flat();
                if (fallback.length > 0) {
                    return res.json(fallback);
                }
            }
        }

        res.json(timeline);
    } catch (error) {
        console.error("Erreur récupération timeline:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

// 🔹 GET /api/user/ffa/performance-timeline
exports.getFfaPerformanceTimeline = async (req, res) => {
    try {
        const { discipline } = req.query;
        const user = await User.findById(req.user.id).select("ffaMergedByEvent ffaResultsByYear");
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        // Priorité : ffaResultsByYear -> buildPerformancePoints
        if (user.ffaResultsByYear) {
            const built = buildPerformancePoints(user.ffaResultsByYear);
            const normalized = discipline ? normalizeDiscipline(discipline) : null;
            const filtered = normalized
                ? built.filter((p) => normalizeDiscipline(p.discipline) === normalized)
                : built;
            if (filtered.length > 0) {
                return res.json(filtered);
            }
        }

        // Fallback ancien format ffaMergedByEvent
        if (user.ffaMergedByEvent) {
            const timelines = buildFfaTimelines(user.ffaMergedByEvent);
            if (discipline) {
                return res.json(timelines[discipline] || []);
            }
            return res.json(timelines);
        }

        return res.json([]);
    } catch (error) {
        console.error("Erreur récupération timeline FFA:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

// 🔹 GET /api/user/ffa/merged-by-event
// Retourne uniquement les données issues de ffaMergedByEvent (sans fallback).
exports.getFfaMergedByEvent = async (req, res) => {
    try {
        const { discipline } = req.query;
        const user = await User.findById(req.user.id).select("ffaMergedByEvent");
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const source = user.ffaMergedByEvent || {};
        const timelines = buildFfaTimelines(source);

        if (discipline) {
            return res.json(timelines[discipline] || []);
        }

        return res.json(timelines);
    } catch (error) {
        console.error("Erreur récupération ffaMergedByEvent:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

exports.addPerformanceTimelinePoint = async (req, res) => {
    try {
        const { date, value, discipline, meeting, city, surface, notes } = req.body;
        if (!discipline || value === undefined || value === null) {
            return res.status(400).json({ message: "Discipline et valeur sont requis" });
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return res.status(400).json({ message: "La valeur doit être numérique" });
        }

        const parsedDate = date ? new Date(date) : new Date();
        if (Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({ message: "Date invalide" });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const point = {
            date: parsedDate,
            value: numericValue,
            discipline,
            meeting,
            city,
            surface,
            notes,
        };

        user.performanceTimeline.push(point);
        await user.save();

        res.status(201).json({ message: "Point ajouté", point });
    } catch (error) {
        console.error("Erreur ajout timeline:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

exports.updateRecords = async (req, res) => {
    try {
        const { records, recordPoints, seasonPerformances } = req.body || {};
        if (!records && !recordPoints && !seasonPerformances) {
            return res.status(400).json({ message: "Aucune donnée à mettre à jour" });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        if (records && typeof records === "object" && !Array.isArray(records)) {
            user.records = sanitizeMapMerge(user.records, records);
        }

        if (recordPoints && typeof recordPoints === "object" && !Array.isArray(recordPoints)) {
            user.recordPoints = sanitizeMapMerge(user.recordPoints, recordPoints);
        }

        if (seasonPerformances && typeof seasonPerformances === "object" && !Array.isArray(seasonPerformances)) {
            user.seasonPerformances = sanitizeMapMerge(user.seasonPerformances, seasonPerformances);
        }

        await user.save();

        res.json({
            message: "Performances mises à jour",
            records: user.records,
            recordPoints: user.recordPoints,
            seasonPerformances: user.seasonPerformances,
        });
    } catch (error) {
        console.error("Erreur mise à jour records:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

exports.searchUsers = async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        if (!query) {
            return res.json([]);
        }

        // Token-based search: allow matching by last name, first name, username,
        // and multi-word queries (e.g. "ben idr" matching "Idris Benali").
        const normalized = query.replace(/\s+/g, " ").trim();
        const tokens = normalized
            .split(" ")
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 4);

        if (!tokens.length) {
            return res.json([]);
        }

        const tokenClauses = tokens.map((token) => {
            const regex = new RegExp(escapeRegex(token), "i");
            return {
                $or: [
                    { fullName: regex },
                    { firstName: regex },
                    { lastName: regex },
                    { username: regex },
                ],
            };
        });

        const results = await User.find({
            _id: { $ne: req.user.id },
            status: { $ne: "deleted" },
            $and: tokenClauses,
        })
            .select("fullName username photoUrl")
            .sort({ fullName: 1 })
            .limit(8);

        const payload = results.map((user) => ({
            id: user._id.toString(),
            fullName: user.fullName,
            username: user.username,
            photoUrl: user.photoUrl,
        }));

        res.json(payload);
    } catch (error) {
        console.error("Erreur recherche utilisateurs:", error);
        res.status(500).json({ message: "Impossible de rechercher des athlètes" });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: "Identifiant requis" });
        }

        const user = await User.findById(id).select("-passwordHash -rpmUserToken");
        if (!user || user.status === "deleted") {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const viewerId = req.user?.id?.toString();
        const isOwner = viewerId && user._id.toString() === viewerId;
        if (!user.isProfilePublic && !isOwner) {
            return res.status(403).json({ message: "Ce profil est privé." });
        }

        const payload = user.toObject({ flattenMaps: true });
        payload.records = payload.records || {};
        payload.recordPoints = payload.recordPoints || {};
        payload.seasonPerformances = payload.seasonPerformances || {};
        payload.performances = payload.performances || [];
        payload.performanceTimeline = payload.performanceTimeline || [];
        payload.relationship = buildRelationshipPayload(user, viewerId);

        res.json(payload);
    } catch (error) {
        console.error("Erreur getUserById:", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

exports.sendFriendRequest = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const { id: targetId } = req.params;

        if (!targetId) {
            return res.status(400).json({ message: "Identifiant d'athlète requis" });
        }

        if (viewerId === targetId) {
            return res.status(400).json({ message: "Impossible de s'envoyer une invitation" });
        }

        const [viewer, target] = await Promise.all([
            User.findById(viewerId),
            User.findById(targetId),
        ]);

        if (!viewer || viewer.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        if (!target || target.status === "deleted") {
            return res.status(404).json({ message: "Athlète cible introuvable" });
        }

        viewer.friendRequestsSent = viewer.friendRequestsSent || [];
        viewer.friendRequestsReceived = viewer.friendRequestsReceived || [];
        viewer.friends = viewer.friends || [];
        target.friendRequestsSent = target.friendRequestsSent || [];
        target.friendRequestsReceived = target.friendRequestsReceived || [];
        target.friends = target.friends || [];

        if (hasObjectId(viewer.friends, target._id)) {
            return res.status(400).json({ message: "Vous êtes déjà amis" });
        }

        if (hasObjectId(viewer.friendRequestsSent, target._id)) {
            return res.status(409).json({ message: "Invitation déjà envoyée" });
        }

        const viewerHasPendingFromTarget = hasObjectId(viewer.friendRequestsReceived, target._id);
        if (viewerHasPendingFromTarget) {
            viewer.friendRequestsReceived = pullObjectId(viewer.friendRequestsReceived, target._id);
            target.friendRequestsSent = pullObjectId(target.friendRequestsSent, viewer._id);
            pushUniqueObjectId(viewer.friends, target._id);
            pushUniqueObjectId(target.friends, viewer._id);

            target.inboxNotifications = target.inboxNotifications || [];
            target.inboxNotifications.unshift({
                type: "friend_request_accepted",
                message: `${viewer.fullName} a accepté votre demande d'amitié`,
                data: { fromUserId: viewer._id?.toString?.() || viewerId },
            });

            await Promise.all([viewer.save(), target.save()]);
            return res.json({
                message: "Invitation acceptée",
                status: "accepted",
                relationship: buildRelationshipPayload(target, viewerId),
            });
        }

        pushUniqueObjectId(viewer.friendRequestsSent, target._id);
        pushUniqueObjectId(target.friendRequestsReceived, viewer._id);
        await Promise.all([viewer.save(), target.save()]);

        return res.status(201).json({
            message: "Invitation envoyée",
            status: "pending",
            relationship: buildRelationshipPayload(target, viewerId),
        });
    } catch (error) {
        console.error("Erreur sendFriendRequest:", error);
        res.status(500).json({ message: "Impossible d'envoyer l'invitation", error });
    }
};

exports.respondFriendRequest = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const { id: requesterId } = req.params;
        const { action } = req.body || {};

        if (!requesterId) {
            return res.status(400).json({ message: "Identifiant d'athlète requis" });
        }

        if (!["accept", "decline"].includes(action)) {
            return res.status(400).json({ message: "Action invalide" });
        }

        const [viewer, requester] = await Promise.all([
            User.findById(viewerId),
            User.findById(requesterId),
        ]);

        if (!viewer || viewer.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        if (!requester || requester.status === "deleted") {
            return res.status(404).json({ message: "Athlète introuvable" });
        }

        viewer.friendRequestsReceived = viewer.friendRequestsReceived || [];
        viewer.friends = viewer.friends || [];
        requester.friendRequestsSent = requester.friendRequestsSent || [];
        requester.friends = requester.friends || [];

        if (!hasObjectId(viewer.friendRequestsReceived, requester._id)) {
            return res.status(404).json({ message: "Aucune invitation en attente" });
        }

        viewer.friendRequestsReceived = pullObjectId(viewer.friendRequestsReceived, requester._id);
        requester.friendRequestsSent = pullObjectId(requester.friendRequestsSent, viewer._id);

        let status = "declined";
        let message = "Invitation refusée";

        if (action === "accept") {
            pushUniqueObjectId(viewer.friends, requester._id);
            pushUniqueObjectId(requester.friends, viewer._id);
            status = "accepted";
            message = "Invitation acceptée";

            requester.inboxNotifications = requester.inboxNotifications || [];
            requester.inboxNotifications.unshift({
                type: "friend_request_accepted",
                message: `${viewer.fullName} a accepté votre demande d'amitié`,
                data: { fromUserId: viewer._id?.toString?.() || viewerId },
            });
        }

        await Promise.all([viewer.save(), requester.save()]);

        return res.json({
            message,
            status,
            relationship: buildRelationshipPayload(requester, viewerId),
        });
    } catch (error) {
        console.error("Erreur respondFriendRequest:", error);
        res.status(500).json({ message: "Impossible de traiter cette invitation", error });
    }
};

exports.removeFriend = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const { id: targetId } = req.params;

        if (!targetId) {
            return res.status(400).json({ message: "Identifiant d'athlète requis" });
        }

        if (viewerId === targetId) {
            return res.status(400).json({ message: "Action non autorisée" });
        }

        const [viewer, target] = await Promise.all([
            User.findById(viewerId),
            User.findById(targetId),
        ]);

        if (!viewer || viewer.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        if (!target || target.status === "deleted") {
            return res.status(404).json({ message: "Athlète introuvable" });
        }

        viewer.friends = viewer.friends || [];
        target.friends = target.friends || [];
        viewer.friendRequestsSent = viewer.friendRequestsSent || [];
        viewer.friendRequestsReceived = viewer.friendRequestsReceived || [];
        target.friendRequestsSent = target.friendRequestsSent || [];
        target.friendRequestsReceived = target.friendRequestsReceived || [];

        if (!hasObjectId(viewer.friends, target._id)) {
            return res.status(404).json({ message: "Vous n'êtes pas amis" });
        }

        viewer.friends = pullObjectId(viewer.friends, target._id);
        target.friends = pullObjectId(target.friends, viewer._id);
        viewer.friendRequestsSent = pullObjectId(viewer.friendRequestsSent, target._id);
        viewer.friendRequestsReceived = pullObjectId(viewer.friendRequestsReceived, target._id);
        target.friendRequestsSent = pullObjectId(target.friendRequestsSent, viewer._id);
        target.friendRequestsReceived = pullObjectId(target.friendRequestsReceived, viewer._id);

        await Promise.all([viewer.save(), target.save()]);

        return res.json({
            message: "Vous ne suivez plus cet athlète",
            status: "removed",
            relationship: buildRelationshipPayload(target, viewerId),
        });
    } catch (error) {
        console.error("Erreur removeFriend:", error);
        res.status(500).json({ message: "Impossible de se désabonner", error });
    }
};

// 🔔 GET /api/user/me/notifications
exports.listMyNotifications = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const user = await User.findById(viewerId).select("inboxNotifications");
        if (!user || user.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        const notifications = Array.isArray(user.inboxNotifications) ? user.inboxNotifications : [];
        const payload = notifications
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((item) => ({
                id: item._id?.toString?.() || item.id,
                type: item.type,
                message: item.message,
                createdAt: item.createdAt,
                data: item.data,
            }));

        return res.json(payload);
    } catch (error) {
        console.error("Erreur listMyNotifications:", error);
        return res.status(500).json({ message: "Impossible de charger les notifications" });
    }
};

// 🔔 DELETE /api/user/me/notifications/:notificationId
exports.deleteMyNotification = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const notificationId = req.params.notificationId?.toString().trim();
        if (!notificationId) {
            return res.status(400).json({ message: "Identifiant de notification requis" });
        }

        const user = await User.findById(viewerId).select("inboxNotifications status");
        if (!user || user.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        const before = user.inboxNotifications?.length ?? 0;
        user.inboxNotifications = (user.inboxNotifications || []).filter(
            (item) => (item._id?.toString?.() || item.id?.toString?.()) !== notificationId,
        );

        const after = user.inboxNotifications?.length ?? 0;
        if (after === before) {
            return res.status(404).json({ message: "Notification introuvable" });
        }

        await user.save();
        return res.json({ ok: true });
    } catch (error) {
        console.error("Erreur deleteMyNotification:", error);
        return res.status(500).json({ message: "Impossible de supprimer la notification" });
    }
};

// 🔔 DELETE /api/user/me/notifications
exports.clearMyNotifications = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const user = await User.findById(viewerId).select("inboxNotifications status");
        if (!user || user.status === "deleted") {
            return res.status(404).json({ message: "Profil utilisateur introuvable" });
        }

        user.inboxNotifications = [];
        await user.save();
        return res.json({ ok: true });
    } catch (error) {
        console.error("Erreur clearMyNotifications:", error);
        return res.status(500).json({ message: "Impossible de supprimer les notifications" });
    }
};

// 🔹 PUT /api/user/credentials
// Permet à l'utilisateur de modifier son mot de passe en fournissant le mot de passe actuel.
exports.updateCredentials = async (req, res) => {
    try {
        const { currentPassword, newPassword, newEmail } = req.body || {};

        if (!newPassword && !newEmail) {
            return res.status(400).json({ message: "Aucune modification demandée" });
        }

        // Récupère explicitement le hash pour vérifier le mot de passe actuel (et laisse le reste par défaut).
        const user = await User.findById(req.user.id).select("+passwordHash");
        console.log(user.email);

        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const hasLocalPassword = Boolean(user.passwordHash);
        if (!hasLocalPassword) {
            console.log(user);
            return res.status(401).json({ message: "Mot de passe actuel incorrect" });
        }

        if (!currentPassword) {
            return res.status(400).json({ message: "Mot de passe actuel requis" });
        }

        // Tolère les mots de passe avec espaces en fin/début : on teste la valeur brute puis une version trim si différente.
        const rawCurrent = String(currentPassword);
        const trimmedCurrent = rawCurrent.trim();

        let isValid = await bcrypt.compare(rawCurrent, String(user.passwordHash));
        if (!isValid && trimmedCurrent !== rawCurrent) {
            isValid = await bcrypt.compare(trimmedCurrent, String(user.passwordHash));
        }
        if (!isValid) {
            return res.status(401).json({ message: "Mot de passe actuel incorrect" });
        }

        if (newPassword) {
            const isSameAsOld = await bcrypt.compare(String(newPassword), String(user.passwordHash));
            if (isSameAsOld) {
                return res.status(400).json({ message: "Le nouveau mot de passe doit être différent de l'actuel" });
            }
            if (String(newPassword).length < 8) {
                return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
            }
            const hashed = await bcrypt.hash(String(newPassword), 10);
            user.passwordHash = hashed;
        }

        if (newEmail) {
            const normalized = String(newEmail).trim().toLowerCase();
            if (!normalized.includes("@") || normalized.length < 5) {
                return res.status(400).json({ message: "Email invalide" });
            }
            if (normalized === String(user.email || "").toLowerCase()) {
                return res.status(400).json({ message: "Le nouvel email doit être différent de l'actuel" });
            }
            const emailInUse = await User.findOne({ email: normalized, _id: { $ne: user._id } }).select("_id");
            if (emailInUse) {
                return res.status(400).json({ message: "Cet email est déjà utilisé" });
            }
            user.email = normalized;
        }

        await user.save();

        const sanitized = user.toObject();
        delete sanitized.passwordHash;
        delete sanitized.rpmUserToken;

        return res.json({ message: "Identifiants mis à jour", user: sanitized });
    } catch (error) {
        console.error("Erreur updateCredentials:", error);
        const message = error?.message || "Erreur lors de la mise à jour des identifiants";
        return res.status(500).json({ message });
    }
};

