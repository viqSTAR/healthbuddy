import { env } from '../config/env.js';
import { logger } from './logger.js';

/** Masks all but the last 3 digits so logs never carry a full phone number. */
const maskPhone = (phone: string) => phone.replace(/.(?=.{3})/g, '•');

const sendViaTwilio = async (to: string, body: string): Promise<boolean> => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    logger.error('[SMS] Twilio selected but credentials are incomplete.');
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
    });

    if (!res.ok) {
      const detail = await res.text();
      logger.error(`[SMS] Twilio rejected the message (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    }

    logger.info(`[SMS] Delivered to ${maskPhone(to)}.`);
    return true;
  } catch (err: any) {
    logger.error(`[SMS] Twilio request failed: ${err.message}`);
    return false;
  }
};

/**
 * Returns whether the message was actually accepted for delivery. The previous
 * implementation returned true unconditionally — including for the Twilio path,
 * which only logged and never made a request.
 */
export const sendSMS = async (phoneNumber: string, message: string): Promise<boolean> => {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return sendViaTwilio(phoneNumber, message);

    case 'msg91':
      logger.error('[SMS] msg91 provider is not implemented.');
      return false;

    case 'mock':
    default:
      // The code is printed only when dev exposure is already enabled, so a
      // misconfigured non-dev box cannot leak OTPs into its log aggregator.
      if (env.EXPOSE_DEV_OTP === 'true') {
        logger.info(`[SMS:mock] To ${maskPhone(phoneNumber)} — ${message}`);
      } else {
        logger.info(`[SMS:mock] Message queued for ${maskPhone(phoneNumber)}.`);
      }
      return true;
  }
};
