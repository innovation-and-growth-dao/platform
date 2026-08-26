import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { NonceService } from './nonce.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { BoardService } from './board.service';
import { DrepLinkService } from './drep-link.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // SEC-07 — never sign sessions with the public dev secret in production.
        const secret = config.get<string>('JWT_SECRET');
        const isProd = config.get<string>('NODE_ENV') === 'production' || config.get<string>('CARDANO_NETWORK') === 'Mainnet';
        if ((!secret || secret.length < 32 || secret === 'change-me-dev-only') && isProd) {
          throw new Error('JWT_SECRET must be set to a strong value (>= 32 chars) in production');
        }
        return {
          secret: secret && secret.length >= 32 ? secret : 'change-me-dev-only',
          signOptions: { expiresIn: '7d' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, NonceService, JwtAuthGuard, BoardService, DrepLinkService],
  exports: [AuthService, JwtAuthGuard, BoardService],
})
export class AuthModule {}
