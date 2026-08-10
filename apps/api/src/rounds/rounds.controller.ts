import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RoundsService } from './rounds.service';

// §26.2 — public read.
@Controller('rounds')
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get()
  list() {
    return this.rounds.list();
  }

  // Must precede ':id' so "active" isn't parsed as a UUID.
  @Get('active')
  active() {
    return this.rounds.activeRound();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rounds.get(id);
  }
}
