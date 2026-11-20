import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { CatsService } from './cats.service'
import { AuthGuard } from '../auth.guard'

@Controller('cats')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Get()
  findAll(): string[] {
    return this.catsService.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string): string {
    return id
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body() body: { name: string }): void {
    this.catsService.add(body.name)
  }
}
