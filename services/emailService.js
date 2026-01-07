const nodemailer = require("nodemailer");
const fetch = require("node-fetch");

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser || "no-reply@tracknfield.app";
const isConfigured = Boolean(smtpHost && smtpUser && smtpPass);

// Brevo API (recommended on platforms that block outbound SMTP)
const brevoApiKey = process.env.BREVO_API_KEY;
const brevoSenderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM;
const brevoSenderName = process.env.BREVO_SENDER_NAME || "Talent-X";
const isBrevoConfigured = Boolean(brevoApiKey && brevoSenderEmail);

const brevoTimeoutMs = Number(process.env.BREVO_TIMEOUT_MS || 10_000);

const sendBrevoEmail = async ({ to, subject, text, html }) => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), brevoTimeoutMs);

    try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "accept": "application/json",
                "content-type": "application/json",
                "api-key": brevoApiKey,
            },
            body: JSON.stringify({
                sender: { email: brevoSenderEmail, name: brevoSenderName },
                to: [{ email: to }],
                subject,
                textContent: text,
                htmlContent: html,
            }),
            signal: controller?.signal,
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            const err = new Error(`Brevo API error: status=${res.status} body=${body}`);
            err.status = res.status;
            throw err;
        }

        return true;
    } finally {
        clearTimeout(timeout);
    }
};

const connectionTimeoutMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10_000);
const greetingTimeoutMs = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10_000);
const socketTimeoutMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20_000);

const transporter = isConfigured
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465 || String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
        auth: { user: smtpUser, pass: smtpPass },
        pool: true,
        maxConnections: 1,
        connectionTimeout: connectionTimeoutMs,
        greetingTimeout: greetingTimeoutMs,
        socketTimeout: socketTimeoutMs,
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


    if (!isBrevoConfigured && (!isConfigured || !transporter)) {
        console.warn("Email non configuré (Brevo API/SMTP), code OTP loggé pour debug", { email: to, code });
        return;
    }

    try {
        const start = Date.now();
        if (isBrevoConfigured) {
            await sendBrevoEmail({ to, subject, text, html });
        } else {
            await transporter.sendMail({ from: smtpFrom, to, subject, text, html });
        }
        const ms = Date.now() - start;
        if (ms > 3000) {
            console.warn("sendVerificationCode slow", { ms, to, provider: isBrevoConfigured ? "brevo-api" : "smtp", host: smtpHost, port: smtpPort });
        }
    } catch (err) {
        console.error("sendVerificationCode mail error", err);
        // On ne propage pas l'erreur: l'API ne doit pas échouer juste parce que l'email est lent/indisponible.
        return;
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

    if (!isBrevoConfigured && (!isConfigured || !transporter)) {
        console.warn("Email non configuré (Brevo API/SMTP), code reset loggé pour debug", { email: to, code });
        return;
    }

    try {
        const start = Date.now();
        if (isBrevoConfigured) {
            await sendBrevoEmail({ to, subject, text, html });
        } else {
            await transporter.sendMail({ from: smtpFrom, to, subject, text, html });
        }
        const ms = Date.now() - start;
        if (ms > 3000) {
            console.warn("sendPasswordResetCode slow", { ms, to, provider: isBrevoConfigured ? "brevo-api" : "smtp", host: smtpHost, port: smtpPort });
        }
    } catch (err) {
        console.error("sendPasswordResetCode mail error", err);
        return;
    }
};
