const nodemailer = require("nodemailer");

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser || "no-reply@tracknfield.app";
const isConfigured = Boolean(smtpHost && smtpUser && smtpPass);

const transporter = isConfigured
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465 || String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
        auth: { user: smtpUser, pass: smtpPass },
    })
    : null;

const formatEmail = (email) => String(email || "").trim().toLowerCase();

exports.sendVerificationCode = async (email, code, ttlMinutes = 10) => {
    const to = formatEmail(email);
    if (!to) return;

    const subject = "Code de vérification Talent-X";

    const text = `
Votre code de vérification Talent-X : ${code}
Ce code est valable pendant ${ttlMinutes} minutes.

Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet email en toute sécurité.
`;

    const html = `
<div style="font-family: Arial, Helvetica, sans-serif; background-color: #f8fafc; padding: 24px;">
    <div style="max-width: 520px; margin: auto; background-color: #ffffff; border-radius: 8px; padding: 24px; color: #0f172a;">
        
        <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #020617;">
            Vérification de votre compte Talent-X
        </h2>

        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
            Pour finaliser votre action, veuillez utiliser le code de vérification ci-dessous :
        </p>

        <div style="text-align: center; margin: 24px 0;">
            <span style="
                display: inline-block;
                font-size: 28px;
                font-weight: 700;
                letter-spacing: 6px;
                color: #0ea5e9;
                padding: 12px 24px;
                border-radius: 6px;
                background-color: #f0f9ff;
            ">
                ${code}
            </span>
        </div>

        <p style="font-size: 14px; color: #334155;">
            Ce code est valable pendant <strong>${ttlMinutes} minutes</strong>.
        </p>

        <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
            Si vous n’êtes pas à l’origine de cette demande, aucune action n’est requise. 
            Votre compte reste sécurisé.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

        <p style="font-size: 12px; color: #94a3b8;">
            © ${new Date().getFullYear()} Talent-X — Tous droits réservés
        </p>

    </div>
</div>
`;


    if (!isConfigured || !transporter) {
        console.warn("SMTP non configuré, code OTP loggé pour debug", { email: to, code });
        return;
    }

    try {
        await transporter.sendMail({ from: smtpFrom, to, subject, text, html });
    } catch (err) {
        console.error("sendVerificationCode mail error", err);
        throw err;
    }
};

exports.sendPasswordResetCode = async (email, code, ttlMinutes = 10) => {
    const to = formatEmail(email);
    if (!to) return;

    const subject = "Réinitialisation de ton mot de passe Talent-X";
    const text = `Code: ${code}\nValide ${ttlMinutes} min.\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email.`;
    const html = `
        <div style="font-family: Arial, sans-serif; color: #0f172a;">
            <p style="font-size: 16px; margin-bottom: 12px;">Tu as demandé à réinitialiser ton mot de passe.</p>
            <p style="font-size: 16px; margin-bottom: 12px;">Voici ton code :</p>
            <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px; color: #0ea5e9;">${code}</p>
            <p style="font-size: 14px; color: #475569; margin-top: 8px;">Valide ${ttlMinutes} minutes.</p>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 12px;">Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
        </div>
    `;

    if (!isConfigured || !transporter) {
        console.warn("SMTP non configuré, code reset loggé pour debug", { email: to, code });
        return;
    }

    try {
        await transporter.sendMail({ from: smtpFrom, to, subject, text, html });
    } catch (err) {
        console.error("sendPasswordResetCode mail error", err);
        throw err;
    }
};
