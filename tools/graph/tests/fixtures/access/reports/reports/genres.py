"""Reports over the catalogue's books, read from the table the catalogue writes."""
import os

import boto3
from boto3.dynamodb.conditions import Key

GENRE_INDEX = "ByGenre"
books = boto3.resource("dynamodb").Table(f"{os.environ['STAGE']}-catalog-books")


def by_genre(genre):
    return books.query(IndexName=GENRE_INDEX, KeyConditionExpression=Key("genre").eq(genre))["Items"]


def count_copies(shelf):
    out = books.query(KeyConditionExpression=Key("shelfId").eq(shelf), ProjectionExpression="copies")
    return sum(int(i["copies"]) for i in out["Items"])
