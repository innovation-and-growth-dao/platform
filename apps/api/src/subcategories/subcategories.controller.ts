import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { SubcategoriesService } from './subcategories.service';

@Controller('subcategories')
export class SubcategoriesController {
  constructor(private readonly svc: SubcategoriesService) {}

  /** Public — the active expertise subcategories every profile/form uses. */
  @Get()
  list() {
    return this.svc.list();
  }

  /** Board — full list (incl. inactive), for the management panel. */
  @Get('all')
  @UseGuards(JwtAuthGuard, BoardGuard)
  listAll() {
    return this.svc.listAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, BoardGuard)
  create(@Body() body: { label?: string }) {
    return this.svc.create(body?.label ?? '');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  patch(@Param('id') id: string, @Body() body: { active?: boolean }) {
    return this.svc.setActive(id, !!body?.active);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
