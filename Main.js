//String, Numbers, Boolean, null, undefined

const name = 'Ian';
const age = 25 ;
const rating = 4.5;
const isCool = true;
const x = null;
const y = undefined;
let z;

console.log(typeof name);
const hello = `My name is ${name} and I am ${age}`;

console.log(hello);

const Languages = ['English', 'Spanish', 'French', 'Portuguese'];

console.log(Languages[3])

Languages.push('Russian');


const person = {
	firstName: 'John'
	lastName: 'Doe'
	age: 30,
	languages: ['English', 'Spanish', 'Russian'],
	address: {
		street: '50 Main St.',
		city: 'Boston',
		state: 'MA'
	}
}

console.log(person.firstName, person.lastName);