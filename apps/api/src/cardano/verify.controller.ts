import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §26.2 — PUBLIC anchor verification (no auth): anyone can fetch an anchor's preimage,
 * recompute sha256(preimage JSON) and compare it to `hash`, then check `txHash` on any
 * explorer to confirm the same hash is embedded in the on-chain metadata.
 */
@Controller('verify')
export class VerifyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('anchor/:id')
  async anchor(@Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.anchor.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('anchor not found');
    return {
      id: a.id,
      kind: a.kind,
      hash: a.hash,
      preimage: a.preimage,
      metadataLabel: a.metadataLabel,
      txHash: a.txHash,
      submittedAt: a.submittedAt,
      createdAt: a.createdAt,
      howToVerify:
        'sha256(JSON.stringify(preimage)) must equal `hash`; the on-chain tx metadata (label ' +
        `${a.metadataLabel}) carries the same proof hash in txHash.`,
    };
  }
}
