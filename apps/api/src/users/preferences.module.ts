import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users.module';
import { PreferencesController } from './preferences.controller';

// Separate module to avoid an Auth↔Users import cycle (AuthModule imports UsersModule).
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [PreferencesController],
})
export class PreferencesModule {}
