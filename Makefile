# DriveCoach — common commands.
# Deploy/destroy are single commands, as required by the assignment.

.PHONY: install test local deploy destroy seed upload results

install:            ## Install Node dependencies
	npm ci

test:               ## Run unit tests
	npm test

local:              ## Run the full pipeline on sample data, no AWS
	npm run local

deploy:             ## Provision everything on AWS (one command)
	terraform -chdir=terraform init -input=false
	terraform -chdir=terraform apply -input=false -auto-approve

destroy:            ## Tear everything down (one command)
	terraform -chdir=terraform destroy -input=false -auto-approve

seed:               ## Load students.csv into DynamoDB (run once after deploy)
	TABLE_NAME=$$(terraform -chdir=terraform output -raw table_name) node scripts/seed_students.js

upload:             ## Upload the sample lessons to the deployed bucket
	./scripts/upload_lessons.sh $$(terraform -chdir=terraform output -raw raw_bucket)
