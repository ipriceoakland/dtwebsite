import { close } from "fs";
import Image from "next/image";

export default function Home() {
  return (
    <div>
      <div className= "topbar">
        <div>
          <button className="topbutton">𝚫t</button>
        </div>
        <div>
          <h1>Schedule</h1>
        </div>
        <div>
          <textarea className="topinput"></textarea>
        </div>
      </div>

      <div className="daycontainer">
        <h1>Sun</h1>
        <h1>Mon</h1>
        <h1>Tue</h1>
        <h1>Wed</h1>
        <h1>Thu</h1>
        <h1>Fri</h1>
        <h1>Sat</h1>
      </div>
      
      <div className="container">
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
        <div> <button className="addbutton">+</button> </div>
      </div>
    </div>
  );
}
