import { ConfigService } from '@nestjs/config';
import { ConsoleOtpSender } from './console-otp-sender';

function createConfig(nodeEnv: string): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue(nodeEnv),
  } as unknown as ConfigService;
}

describe('ConsoleOtpSender', () => {
  it('refuses to start when NODE_ENV is production', () => {
    expect(() => new ConsoleOtpSender(createConfig('production'))).toThrow(
      'OTP_SENDER=console is not allowed in production',
    );
  });

  it('starts outside production', () => {
    expect(
      () => new ConsoleOtpSender(createConfig('development')),
    ).not.toThrow();
  });

  it('prints the code to stdout when sending', async () => {
    const sender = new ConsoleOtpSender(createConfig('development'));
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await sender.send({
      to: 'user@example.com',
      code: '123456',
      purpose: 'EMAIL_VERIFICATION',
      expiresInMinutes: 10,
    });

    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });
});
