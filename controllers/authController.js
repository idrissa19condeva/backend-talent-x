const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { fetchFfaByName } = require("../services/ffaService");

const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

const signAccessToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
const signRefreshToken = (userId) => jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
const DEFAULT_FFA_YEARS = ["2025", "2024", "2023"]; // aligné sur fetch-ffa-autocomplete

// 🧾 Inscription
exports.signup = async (req, res) => {
    try {
        const { firstName, lastName, email, password, birthDate, gender, role } = req.body;

        if (!firstName || !lastName || !email || !password || !birthDate || !gender || !role) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        const parsedBirthDate = new Date(birthDate);
        if (Number.isNaN(parsedBirthDate.getTime())) {
            return res.status(400).json({ message: "Date de naissance invalide" });
        }

        if (!["male", "female"].includes(gender)) {
            return res.status(400).json({ message: "Genre invalide" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email déjà utilisé" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email,
            passwordHash: hashedPassword,
            birthDate: parsedBirthDate,
            gender,
            role,
        });

        await user.save();

        // Import FFA : enregistre records / performances / timeline pour l'athlète
        if (role === "athlete") {
            try {
                const ffa = await fetchFfaByName(firstName, lastName, DEFAULT_FFA_YEARS);

                const mergedByEvent = {};
                if (ffa?.resultsByYear) {
                    for (const [year, events] of Object.entries(ffa.resultsByYear)) {
                        for (const [epreuve, entries] of Object.entries(events)) {
                            mergedByEvent[epreuve] = mergedByEvent[epreuve] || [];
                            mergedByEvent[epreuve].push(...entries.map((e) => ({ ...e, year })));
                        }
                    }
                }

                const records = {};
                const recordPoints = {};
                // recordsByEvent est déjà calculé côté service (meilleurs points)
                if (ffa?.recordsByEvent) {
                    for (const [epreuve, entry] of Object.entries(ffa.recordsByEvent)) {
                        records[epreuve] = entry?.performance;
                        if (entry?.points !== undefined && entry?.points !== null) {
                            const parsed = Number(entry.points);
                            if (Number.isFinite(parsed)) {
                                recordPoints[epreuve] = parsed;
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
                for (const [epreuve, entries] of Object.entries(mergedByEvent)) {
                    const sorted = entries
                        .slice()
                        .sort((a, b) => {
                            const da = parseFrenchDate(a.date, a.year) ?? new Date(0);
                            const db = parseFrenchDate(b.date, b.year) ?? new Date(0);
                            return db - da;
                        });

                    if (sorted.length) {
                        const bestSeasonEntry = sorted.find((e) => (e.year || e.date || "").includes(currentYearStr)) || sorted[0];
                        performances.push({
                            epreuve,
                            record: sorted[0]?.performance,
                            bestSeason: bestSeasonEntry?.performance,
                        });
                    }

                    for (const entry of sorted) {
                        const parsedDate = parseFrenchDate(entry.date, entry.year);
                        performanceTimeline.push({
                            date: parsedDate || null,
                            rawDate: entry.date,
                            year: entry.year ? Number(entry.year) || undefined : undefined,
                            discipline: epreuve,
                            value: entry.performance,
                            meeting: entry.lieu,
                            notes: entry.tour,
                            source: "ffa",
                        });
                    }
                }

                await User.findByIdAndUpdate(
                    user._id,
                    {
                        $set: {
                            records,
                            recordPoints,
                            performances,
                            performanceTimeline,
                            ffaResultsByYear: ffa?.resultsByYear || {},
                            ffaMergedByEvent: mergedByEvent,
                        },
                    },
                    { new: true },
                );

                // mets à jour l'instance pour la réponse
                user.records = records;
                user.recordPoints = recordPoints;
                user.performances = performances;
                user.performanceTimeline = performanceTimeline;
            } catch (importErr) {
                console.warn("FFA signup - échec import/log:", importErr.message);
            }
        }

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
            payload = jwt.verify(refreshToken, REFRESH_SECRET);
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
