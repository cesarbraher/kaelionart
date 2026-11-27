function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, bodyHtml, ctaLabel, ctaUrl }) {
  const ctaBlock = ctaUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#682831;color:#EAE7E8;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:600;">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="es-MX">
<body style="margin:0;padding:24px;background:#111012;color:#D4D1D2;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;background:#211F23;border:1px solid #3C3A40;border-radius:6px;padding:28px;">
    <p style="margin:0 0 12px;color:#B85B64;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;">KAELION DIGITAL ART · PORTAL DE CLIENTES</p>
    <h1 style="margin:0 0 16px;color:#EAE7E8;font-size:22px;font-family:Georgia,serif;">${escapeHtml(title)}</h1>
    <div style="font-size:15px;line-height:1.6;color:#D4D1D2;">${bodyHtml}</div>
    ${ctaBlock}
    <hr style="border:none;border-top:1px solid #3C3A40;margin:24px 0;" />
    <p style="margin:0;font-size:12px;color:#9D999F;">KAELION Digital Art · kaelion.art · WhatsApp +52 464 109 3886</p>
  </div>
</body>
</html>`;
}

export function renderMailTemplate(templateName, payload = {}) {
  switch (templateName) {
    case 'verify_email':
      return {
        text: `Hola ${payload.fullName || ''},\n\nVerifica tu correo en el portal de KAELION Digital Art abriendo este enlace:\n${payload.verifyUrl}\n\nEste enlace vence en 24 horas.`,
        html: layout({
          title: 'Confirma tu dirección de correo',
          bodyHtml: `<p>Hola <strong>${escapeHtml(payload.fullName)}</strong>,</p><p>Gracias por registrarte en el portal de clientes de KAELION Digital Art. Confirma tu correo para guardar tu brief y dar seguimiento a tus encargos.</p>`,
          ctaLabel: 'Verificar correo',
          ctaUrl: payload.verifyUrl,
        }),
      };

    case 'password_reset':
      return {
        text: `Hola ${payload.fullName || ''},\n\nSolicitaste restablecer tu contraseña. Usa este enlace de un solo uso (válido por 60 minutos):\n${payload.resetUrl}`,
        html: layout({
          title: 'Restablecer contraseña',
          bodyHtml: `<p>Hola <strong>${escapeHtml(payload.fullName)}</strong>,</p><p>Recibimos una solicitud para restablecer la contraseña de tu cuenta. El enlace es de un solo uso y vence en 60 minutos.</p>`,
          ctaLabel: 'Crear nueva contraseña',
          ctaUrl: payload.resetUrl,
        }),
      };

    case 'payment_confirmed':
      return {
        text: `Pago confirmado ($250.00 MXN) para el pedido ${payload.folio} (${payload.brandName || ''}).\n\nTu encargo ya está activo en el taller de KAELION Digital Art. Consulta el avance en: ${payload.portalUrl}`,
        html: layout({
          title: `Pago confirmado · Folio ${payload.folio}`,
          bodyHtml: `<p>Confirmamos tu pago único de <strong>$250.00 MXN</strong> por <em>Diseño inteligente de logotipos</em> para <strong>${escapeHtml(payload.brandName)}</strong>.</p><p>Nuestro taller ya trabaja en tus tres propuestas originales. Te avisaremos en cuanto estén listas en tu portal.</p>`,
          ctaLabel: 'Ver mi pedido en el portal',
          ctaUrl: payload.portalUrl,
        }),
      };

    case 'proposals_ready':
      return {
        text: `Tus 3 propuestas de logotipo para el folio ${payload.folio} ya están listas.\n\nIngresa a tu portal para elegir tu favorita: ${payload.portalUrl}`,
        html: layout({
          title: `Tus 3 propuestas están listas · ${payload.folio}`,
          bodyHtml: `<p>El taller publicó las tres propuestas originales para <strong>${escapeHtml(payload.brandName)}</strong>.</p><p>Ingresa al portal para revisarlas, elegir tu favorita y aprobarla o solicitar hasta 3 rondas de ajustes agrupados.</p>`,
          ctaLabel: 'Revisar propuestas',
          ctaUrl: payload.portalUrl,
        }),
      };

    case 'revision_ready':
      return {
        text: `La ronda de ajuste #${payload.roundNumber} del pedido ${payload.folio} ya está lista para revisión.\n\nIngresa al portal: ${payload.portalUrl}`,
        html: layout({
          title: `Ajuste listo (Ronda ${payload.roundNumber} de 3) · ${payload.folio}`,
          bodyHtml: `<p>El taller actualizó la propuesta elegida para <strong>${escapeHtml(payload.brandName)}</strong> conforme a tus comentarios.</p><p>Revisa la nueva versión en tu portal para aprobarla o enviar una siguiente ronda si todavía tienes rondas disponibles.</p>`,
          ctaLabel: 'Revisar versión actualizada',
          ctaUrl: payload.portalUrl,
        }),
      };

    case 'order_delivered':
      return {
        text: `Tu paquete final de logotipo (AI, SVG, PDF vectorial, PNG y JPG) para el folio ${payload.folio} ya está disponible.\n\nDescárgalo desde tu portal privado: ${payload.portalUrl}`,
        html: layout({
          title: `Archivos finales disponibles · ${payload.folio}`,
          bodyHtml: `<p>Tu entrega oficial de <strong>${escapeHtml(payload.brandName)}</strong> ha sido confirmada.</p><p>Ya puedes descargar tus cinco formatos profesionales (<strong>AI, SVG, PDF vectorial, PNG y JPG</strong>) desde tu portal con enlaces privados seguros.</p>`,
          ctaLabel: 'Descargar archivos finales',
          ctaUrl: payload.portalUrl,
        }),
      };

    default:
      return {
        text: JSON.stringify(payload),
        html: layout({
          title: 'Notificación de KAELION Digital Art',
          bodyHtml: `<p>Tienes una nueva actualización en tu portal de clientes.</p>`,
          ctaLabel: 'Abrir portal',
          ctaUrl: payload.portalUrl || '',
        }),
      };
  }
}
