import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';

/** slug: lowercase, non-alphanumerics → single dashes, trimmed. */
const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * §5.3 — expertise subcategories. Stored in the `subcategory` table so the board can add/remove
 * them at runtime; the shared DEFAULT_SUBCATEGORIES list seeds an empty table (fresh install or a
 * DB that never had them) so the platform always starts with a sensible set.
 */
@Injectable()
export class SubcategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // One-time seed: insert any missing defaults (covers a fresh DB and a partially-seeded one),
  // then set a flag so later reads never re-add a default the board deliberately removed.
  private async ensureSeeded(): Promise<void> {
    if (await this.prisma.platformConfig.findUnique({ where: { key: 'SUBCATEGORIES_SEEDED' }, select: { key: true } })) return;
    await this.prisma.subcategory.createMany({
      data: DEFAULT_SUBCATEGORIES.map((s, i) => ({ id: s.id, label: s.label, active: true, sortIdx: i })),
      skipDuplicates: true,
    });
    await this.prisma.platformConfig.upsert({
      where: { key: 'SUBCATEGORIES_SEEDED' },
      create: { key: 'SUBCATEGORIES_SEEDED', value: true },
      update: {},
    });
  }

  /** Public: the active subcategories, in display order. */
  async list(): Promise<{ id: string; label: string }[]> {
    await this.ensureSeeded();
    return this.prisma.subcategory.findMany({
      where: { active: true },
      orderBy: [{ sortIdx: 'asc' }, { label: 'asc' }],
      select: { id: true, label: true },
    });
  }

  /** Board: every subcategory including deactivated ones. */
  async listAll(): Promise<{ id: string; label: string; active: boolean }[]> {
    await this.ensureSeeded();
    return this.prisma.subcategory.findMany({
      orderBy: [{ sortIdx: 'asc' }, { label: 'asc' }],
      select: { id: true, label: true, active: true },
    });
  }

  async create(label: string) {
    const clean = (label ?? '').trim();
    if (clean.length < 2) throw new BadRequestException('a subcategory needs a name (2+ characters)');
    const id = slugify(clean);
    if (!id) throw new BadRequestException('the name must contain letters or numbers');
    const existing = await this.prisma.subcategory.findUnique({ where: { id } });
    if (existing) {
      // A previously-removed (deactivated) one with the same slug is simply reactivated + relabelled.
      if (existing.active) throw new BadRequestException('that subcategory already exists');
      await this.prisma.subcategory.update({ where: { id }, data: { active: true, label: clean } });
      return this.listAll();
    }
    const max = await this.prisma.subcategory.aggregate({ _max: { sortIdx: true } });
    await this.prisma.subcategory.create({
      data: { id, label: clean, active: true, sortIdx: (max._max.sortIdx ?? 0) + 1 },
    });
    return this.listAll();
  }

  async setActive(id: string, active: boolean) {
    try {
      await this.prisma.subcategory.update({ where: { id }, data: { active } });
    } catch {
      throw new NotFoundException('subcategory not found');
    }
    return this.listAll();
  }

  async remove(id: string) {
    try {
      await this.prisma.subcategory.delete({ where: { id } });
    } catch {
      throw new NotFoundException('subcategory not found');
    }
    return this.listAll();
  }
}
