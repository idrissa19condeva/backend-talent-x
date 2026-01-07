const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { fetchFfaByName } = require("../services/ffaService");
const EmailVerification = require("../models/EmailVerification");
const { normalizePersonName } = require("../utils/nameFormat");
const emailService = require("../services/emailService");

const ACCESS_EXPIRES_IN = () => process.env.JWT_EXPIRES_IN || "7d";
const REFRESH_EXPIRES_IN = () => process.env.JWT_REFRESH_EXPIRES_IN || "30d";
// Read secrets lazily at call-time to avoid import-order issues with dotenv.
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const EMAIL_CODE_TTL_MINUTES = Number(process.env.EMAIL_CODE_TTL_MINUTES || 10);
const EMAIL_CODE_MAX_ATTEMPTS = Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5);
const PASSWORD_RESET_CODE_TTL_MINUTES = Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES || 10);
const PASSWORD_RESET_CODE_MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_CODE_MAX_ATTEMPTS || 5);

const RESET_CODE_SECRET = () => process.env.PASSWORD_RESET_CODE_SECRET || process.env.JWT_SECRET || "tracknfield";
const hashResetCode = (code) => crypto.createHash("sha256").update(`${String(code || "").trim()}:${RESET_CODE_SECRET()}`).digest("hex");

const signAccessToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN() });
const signRefreshToken = (userId) => jwt.sign({ id: userId }, REFRESH_SECRET(), { expiresIn: REFRESH_EXPIRES_IN() });
const DEFAULT_FFA_YEARS = []; // vide => on récupère toutes les années disponibles pour l'athlète
const sanitizeKey = (value = "") => value.replace(/\./g, "_");
const generateEmailCode = () => String(Math.floor(100000 + Math.random() * 900000));

// 🔐 Envoie un code reset mot de passe par email (si le compte existe)
exports.requestPasswordResetCode = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ message: "Email requis" });
        }

        // Toujours répondre OK pour éviter de leak l'existence d'un compte.
        const user = await User.findOne({ email }).select("+passwordResetCodeHash +passwordResetExpiresAt +passwordResetAttempts +passwordResetRequestedAt");
        if (user) {
            const code = generateEmailCode();
            user.passwordResetCodeHash = hashResetCode(code);
            user.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60 * 1000);
            user.passwordResetAttempts = 0;
            user.passwordResetRequestedAt = new Date();
            await user.save();

            // Envoi email en arrière-plan: ne bloque pas la réponse HTTP.
            setImmediate(async () => {
                try {
                    if (typeof emailService.sendPasswordResetCode === "function") {
                        await emailService.sendPasswordResetCode(email, code, PASSWORD_RESET_CODE_TTL_MINUTES);
                    } else {
                        await emailService.sendVerificationCode(email, code, PASSWORD_RESET_CODE_TTL_MINUTES);
                    }
                } catch (mailErr) {
                    console.error("sendPasswordResetCode error", mailErr);
                }
            });
        }

        return res.json({ ok: true });
    } catch (error) {
        console.error("requestPasswordResetCode error", error);
        return res.status(500).json({ message: "Impossible d'envoyer le code" });
    }
};

// 🔐 Vérifie un code reset mot de passe
exports.verifyPasswordResetCode = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const code = String(req.body.code || "").trim();

        if (!email || !code) {
            return res.status(400).json({ message: "Email et code requis" });
        }

        const user = await User.findOne({ email }).select("+passwordResetCodeHash +passwordResetExpiresAt +passwordResetAttempts");
        if (!user?.passwordResetCodeHash || !user?.passwordResetExpiresAt) {
            return res.status(400).json({ message: "Code invalide ou expiré" });
        }

        if ((user.passwordResetAttempts || 0) >= PASSWORD_RESET_CODE_MAX_ATTEMPTS) {
            return res.status(429).json({ message: "Trop de tentatives, redemande un code" });
        }

        if (user.passwordResetExpiresAt.getTime() < Date.now()) {
            return res.status(400).json({ message: "Code expiré, redemande un nouveau code" });
        }

        if (hashResetCode(code) !== user.passwordResetCodeHash) {
            user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
            await user.save();
            const remaining = Math.max(PASSWORD_RESET_CODE_MAX_ATTEMPTS - (user.passwordResetAttempts || 0), 0);
            return res.status(400).json({ message: "Code incorrect", remainingAttempts: remaining });
        }

        user.passwordResetAttempts = 0;
        await user.save();

        return res.json({ verified: true });
    } catch (error) {
        console.error("verifyPasswordResetCode error", error);
        return res.status(500).json({ message: "Impossible de vérifier le code" });
    }
};

// 🔐 Confirme le reset mot de passe (code + nouveau mdp)
exports.confirmPasswordReset = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const code = String(req.body.code || "").trim();
        const newPassword = String(req.body.newPassword || "");

        if (!email || !code || !newPassword) {
            return res.status(400).json({ message: "Email, code et nouveau mot de passe requis" });
        }

        if (newPassword.trim().length < 6) {
            return res.status(400).json({ message: "Mot de passe trop court (6 caractères min.)" });
        }

        const user = await User.findOne({ email }).select("+passwordResetCodeHash +passwordResetExpiresAt +passwordResetAttempts");
        if (!user?.passwordResetCodeHash || !user?.passwordResetExpiresAt) {
            return res.status(400).json({ message: "Code invalide ou expiré" });
        }

        if ((user.passwordResetAttempts || 0) >= PASSWORD_RESET_CODE_MAX_ATTEMPTS) {
            return res.status(429).json({ message: "Trop de tentatives, redemande un code" });
        }

        if (user.passwordResetExpiresAt.getTime() < Date.now()) {
            return res.status(400).json({ message: "Code expiré, redemande un nouveau code" });
        }

        if (hashResetCode(code) !== user.passwordResetCodeHash) {
            user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
            await user.save();
            const remaining = Math.max(PASSWORD_RESET_CODE_MAX_ATTEMPTS - (user.passwordResetAttempts || 0), 0);
            return res.status(400).json({ message: "Code incorrect", remainingAttempts: remaining });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        user.passwordResetCodeHash = undefined;
        user.passwordResetExpiresAt = undefined;
        user.passwordResetAttempts = 0;
        user.passwordResetRequestedAt = undefined;
        await user.save();

        return res.json({ ok: true });
    } catch (error) {
        console.error("confirmPasswordReset error", error);
        return res.status(500).json({ message: "Impossible de réinitialiser le mot de passe" });
    }
};

const parseWind = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
    const cleaned = String(raw).replace(/,/g, ".").replace(/m\/?s/i, "").trim();
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const value = parseFloat(match[0]);
    return Number.isFinite(value) ? value : undefined;
};

// Vérifie si un email existe déjà (pré-inscription)
exports.checkEmail = async (req, res) => {
    try {
        const email = String(req.query.email || "").trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ message: "Email requis" });
        }
        const existing = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } }).select("_id");
        return res.json({ exists: Boolean(existing) });
    } catch (error) {
        console.error("checkEmail error", error);
        return res.status(500).json({ message: "Erreur lors de la vérification" });
    }
};

// Envoie un code OTP par email
exports.requestEmailCode = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ message: "Email requis" });
        }

        const existing = await User.findOne({ email }).select("_id");
        if (existing) {
            return res.status(400).json({ message: "Email déjà utilisé" });
        }

        const code = generateEmailCode();
        const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000);

        await EmailVerification.findOneAndUpdate(
            { email },
            { email, code, expiresAt, attempts: 0, verifiedAt: null },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Répond vite, puis envoie l'email en arrière-plan.
        const response = { ok: true, expiresAt };
        res.json(response);

        setImmediate(async () => {
            try {
                await emailService.sendVerificationCode(email, code, EMAIL_CODE_TTL_MINUTES);
            } catch (mailErr) {
                console.error("sendVerificationCode error", mailErr);
            }
        });

        return;
    } catch (error) {
        console.error("requestEmailCode error", error);
        return res.status(500).json({ message: "Impossible d'envoyer le code" });
    }
};

// Vérifie un code OTP email
exports.verifyEmailCode = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const code = String(req.body.code || "").trim();

        const mask = (value) => {
            if (!value) return "";
            if (value.length <= 2) return "**";
            return `${value.slice(0, 2)}***`;
        };

        console.info("verifyEmailCode attempt", { email, code: mask(code) });

        if (!email || !code) {
            return res.status(400).json({ message: "Email et code requis" });
        }

        const record = await EmailVerification.findOne({ email }).sort({ createdAt: -1 }).exec();
        if (!record) {
            console.warn("verifyEmailCode record not found", { email });
            return res.status(400).json({ message: "Code invalide ou expiré" });
        }

        if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
            console.warn("verifyEmailCode too many attempts", { email, attempts: record.attempts });
            return res.status(429).json({ message: "Trop de tentatives, redemande un code" });
        }

        if (record.expiresAt.getTime() < Date.now()) {
            console.warn("verifyEmailCode expired", { email, expiresAt: record.expiresAt });
            return res.status(400).json({ message: "Code expiré, redemande un nouveau code" });
        }

        if (record.code !== code) {
            record.attempts += 1;
            await record.save();
            const remaining = Math.max(EMAIL_CODE_MAX_ATTEMPTS - record.attempts, 0);
            console.warn("verifyEmailCode mismatch", { email, attempts: record.attempts, remaining });
            return res.status(400).json({ message: "Code incorrect", remainingAttempts: remaining });
        }

        record.verifiedAt = new Date();
        record.attempts = 0;
        await record.save();

        console.info("verifyEmailCode success", { email, verifiedAt: record.verifiedAt });

        return res.json({ verified: true, verifiedAt: record.verifiedAt });
    } catch (error) {
        console.error("verifyEmailCode error", error);
        return res.status(500).json({ message: "Impossible de vérifier le code" });
    }
};

// 🧾 Inscription
exports.signup = async (req, res) => {
    try {
        const { firstName, lastName, email, password, birthDate, gender, role, mainDisciplineFamily, mainDiscipline, licenseNumber } = req.body;

        if (!firstName || !lastName || !email || !password || !birthDate || !gender || !role) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        const normalizedLicense = String(licenseNumber || "").trim();
        const isCoach = String(role).trim() === "coach";
        if (!isCoach && !normalizedLicense) {
            return res.status(400).json({ message: "Le numéro de licence est requis" });
        }

        const parsedBirthDateParts = String(birthDate || "").split("-").map((v) => Number(v));
        const parsedBirthDate = parsedBirthDateParts.length === 3
            ? new Date(Date.UTC(parsedBirthDateParts[0], parsedBirthDateParts[1] - 1, parsedBirthDateParts[2]))
            : new Date(birthDate);
        if (!birthDate || Number.isNaN(parsedBirthDate.getTime())) {
            return res.status(400).json({ message: "Date de naissance invalide" });
        }

        if (!["male", "female"].includes(gender)) {
            return res.status(400).json({ message: "Genre invalide" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email déjà utilisé" });
        }

        // Ensure email was verified recently
        const recentVerification = await EmailVerification.findOne({ email, verifiedAt: { $ne: null } })
            .sort({ verifiedAt: -1 })
            .exec();

        if (!recentVerification || Date.now() - recentVerification.verifiedAt.getTime() > EMAIL_CODE_TTL_MINUTES * 60 * 1000) {
            return res.status(400).json({ message: "Email not verified. Please confirm the code we sent." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const normalizedFirstName = normalizePersonName(firstName);
        const normalizedLastName = normalizePersonName(lastName);
        const normalizedFullName = `${normalizedFirstName} ${normalizedLastName}`.trim();

        const user = new User({
            fullName: normalizedFullName,
            firstName: normalizedFirstName,
            lastName: normalizedLastName,
            email,
            passwordHash: hashedPassword,
            birthDate: parsedBirthDate,
            gender,
            role,
            mainDisciplineFamily: mainDisciplineFamily || undefined,
            mainDiscipline: mainDiscipline || undefined,
            licenseNumber: isCoach ? undefined : normalizedLicense,
        });

        // Import FFA : enregistre records / performances / timeline pour l'athlète
        if (role === "athlete") {
            try {
                const ffa = await fetchFfaByName(normalizedFirstName, normalizedLastName, DEFAULT_FFA_YEARS, normalizedLicense);

                if (normalizedLicense) {
                    if (ffa?.licenseCheckFailed) {
                        console.warn("FFA signup - licence check failed", { firstName: normalizedFirstName, lastName: normalizedLastName, license: normalizedLicense, actseq: ffa?.actseq });
                        return res.status(502).json({ message: "Impossible de vérifier le numéro de licence sur la fiche FFA pour le moment" });
                    }
                    if (ffa?.licenseVerified === false) {
                        console.warn("FFA signup - licence mismatch", { firstName: normalizedFirstName, lastName: normalizedLastName, license: normalizedLicense, actseq: ffa?.actseq, licensesFound: ffa?.licensesFound });
                        return res.status(400).json({ message: "Numéro de licence introuvable sur la fiche FFA pour cet athlète" });
                    }
                }

                if (!ffa) {
                    console.warn("FFA signup - aucun résultat FFA", { firstName: normalizedFirstName, lastName: normalizedLastName });
                    return res.status(502).json({ message: "Impossible de récupérer la fiche FFA" });
                }

                const mergedByEvent = {};
                const safeResultsByYear = {};
                if (ffa?.resultsByYear) {
                    for (const [year, events] of Object.entries(ffa.resultsByYear)) {
                        for (const [epreuve, entries] of Object.entries(events)) {
                            const safeKey = sanitizeKey(epreuve);
                            const enriched = entries.map((e) => ({ ...e, year, epreuveOriginal: epreuve }));
                            mergedByEvent[safeKey] = mergedByEvent[safeKey] || [];
                            mergedByEvent[safeKey].push(...enriched);

                            safeResultsByYear[year] = safeResultsByYear[year] || {};
                            safeResultsByYear[year][safeKey] = enriched;
                        }
                    }
                }

                const records = {};
                const recordPoints = {};
                // recordsByEvent est déjà calculé côté service (meilleurs points)
                if (ffa?.recordsByEvent) {
                    for (const [epreuve, entry] of Object.entries(ffa.recordsByEvent)) {
                        const safeKey = sanitizeKey(epreuve);
                        records[safeKey] = entry?.performance;
                        if (entry?.points !== undefined && entry?.points !== null) {
                            const parsed = Number(entry.points);
                            if (Number.isFinite(parsed)) {
                                recordPoints[safeKey] = parsed;
                            }
                        }
                    }
                }

                const performances = [];
                const performanceTimeline = [];

                const parseFrenchDate = (value, yearHint) => {
                    if (!value) return null;
                    const raw = value.trim().replace(/\./g, "").toLowerCase();
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
                    const match = raw.match(/^(\d{1,2})\s+([a-zéûô]+)$/i);
                    if (!match) return null;
                    const day = Number(match[1]);
                    const monthKey = match[2];
                    const month = monthMap[monthKey];
                    if (month === undefined || Number.isNaN(day)) return null;
                    const year = Number(yearHint) || new Date().getFullYear();
                    const d = new Date(year, month, day);
                    return Number.isNaN(d.getTime()) ? null : d;
                };

                const currentYearStr = String(new Date().getFullYear());
                for (const [epreuveKey, entries] of Object.entries(mergedByEvent)) {
                    const enrichedWithWind = entries.map((e) => ({ ...e, wind: parseWind(e.vent) }));

                    const sorted = enrichedWithWind
                        .slice()
                        .sort((a, b) => {
                            const da = parseFrenchDate(a.date, a.year) ?? new Date(0);
                            const db = parseFrenchDate(b.date, b.year) ?? new Date(0);
                            return db - da;
                        });

                    const label = sorted[0]?.epreuveOriginal || epreuveKey;

                    const legalSorted = sorted.filter((e) => {
                        const w = e.wind;
                        // Vent non renseigné => accepté; vent mesuré <= 2.0 => accepté
                        return w === undefined || w === null || w <= 2.0;
                    });

                    if (sorted.length) {
                        const bestLegal = legalSorted[0] || sorted[0];
                        const bestSeasonEntry = legalSorted.find((e) => (e.year || e.date || "").includes(currentYearStr))
                            || sorted.find((e) => (e.year || e.date || "").includes(currentYearStr))
                            || bestLegal;
                        performances.push({
                            epreuve: label,
                            record: bestLegal?.performance,
                            bestSeason: bestSeasonEntry?.performance,
                        });
                    }

                    for (const entry of sorted) {
                        const parsedDate = parseFrenchDate(entry.date, entry.year);
                        performanceTimeline.push({
                            date: parsedDate || null,
                            rawDate: entry.date,
                            year: entry.year ? Number(entry.year) || undefined : undefined,
                            discipline: entry.epreuveOriginal || epreuveKey,
                            value: entry.performance,
                            meeting: entry.lieu,
                            notes: entry.tour,
                            source: "ffa",
                            wind: entry.wind,
                        });
                    }
                }

                // hydrate l'instance pour persistance après validations FFA
                user.records = records;
                user.recordPoints = recordPoints;
                user.performances = performances;
                // Some FFA rows can have missing/blank performance values; Mongoose requires `value`.
                user.performanceTimeline = (performanceTimeline || [])
                    .filter((entry) => {
                        const value = typeof entry?.value === "string" ? entry.value.trim() : "";
                        const discipline = typeof entry?.discipline === "string" ? entry.discipline.trim() : "";
                        return Boolean(value) && Boolean(discipline);
                    })
                    .map((entry) => ({
                        ...entry,
                        value: typeof entry.value === "string" ? entry.value.trim() : entry.value,
                        discipline:
                            typeof entry.discipline === "string" ? entry.discipline.trim() : entry.discipline,
                    }));
                user.ffaResultsByYear = safeResultsByYear;
                user.ffaMergedByEvent = mergedByEvent;
            } catch (importErr) {
                console.warn("FFA signup - échec import/log:", importErr.message);
            }
        }

        // on ne persiste qu'après toutes les validations (FFA incluse)
        await user.save();

        const token = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        res.status(201).json({
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.fullName,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                birthDate: user.birthDate,
                gender: user.gender,
                role: user.role,
                records: user.records,
                recordPoints: user.recordPoints,
                performances: user.performances,
                performanceTimeline: user.performanceTimeline,
                mainDiscipline: user.mainDiscipline,
                mainDisciplineFamily: user.mainDisciplineFamily,
                licenseNumber: user.licenseNumber,
            },
        });
    } catch (err) {
        console.error("Erreur signup :", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

// 🔐 Connexion
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Utilisateur introuvable" });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ message: "Mot de passe incorrect" });
        }

        const token = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        res.status(200).json({
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.fullName,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                birthDate: user.birthDate,
                gender: user.gender,
                role: user.role,
                records: user.records,
                recordPoints: user.recordPoints,
                performances: user.performances,
                performanceTimeline: user.performanceTimeline,
            },
        });
    } catch (err) {
        console.error("Erreur login :", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

// 🔁 Rafraîchir un access token à partir d'un refresh token
exports.refresh = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ message: "Refresh token requis" });
        }

        let payload;
        try {
            payload = jwt.verify(refreshToken, REFRESH_SECRET());
        } catch (err) {
            return res.status(401).json({ message: "Refresh token invalide" });
        }

        const user = await User.findById(payload.id);
        if (!user) {
            return res.status(401).json({ message: "Utilisateur introuvable" });
        }

        const token = signAccessToken(user._id);
        const newRefreshToken = signRefreshToken(user._id);

        return res.status(200).json({
            token,
            refreshToken: newRefreshToken,
            user: {
                id: user._id,
                name: user.fullName,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                birthDate: user.birthDate,
                gender: user.gender,
                role: user.role,
                records: user.records,
                recordPoints: user.recordPoints,
                performances: user.performances,
                performanceTimeline: user.performanceTimeline,
            },
        });
    } catch (err) {
        console.error("Erreur refresh :", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
};
