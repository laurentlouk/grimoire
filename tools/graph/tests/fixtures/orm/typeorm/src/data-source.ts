import "reflect-metadata"
import { DataSource } from "typeorm"
import { User } from "./entity/User"
import { Post } from "./entity/Post"

export const AppDataSource = new DataSource({
    type: "postgres",
    host: "localhost",
    port: 5432,
    username: "app",
    password: process.env.DB_PASSWORD,
    database: "app",
    synchronize: false,
    entities: [User, Post],
    migrations: ["src/migration/*.ts"],
})
