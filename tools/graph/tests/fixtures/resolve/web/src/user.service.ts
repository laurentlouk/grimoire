import { Repository } from 'typeorm'

export class UserService {
  constructor(private readonly userRepository: Repository<UserEntity>) {}

  findOne(id: string) {
    return this.userRepository.findOne(id)
  }

  findById(id: string) {
    return this.userRepository.findOne({ id })
  }
}

export class Base {
  save() {
    return 1
  }
}

export class Child extends Base {
  save() {
    return super.save()
  }
}
